import type {
  LinkedDeployment,
  LinkedPullRequest,
  ReleaseContext,
  ReviewSignal,
  WorkItem,
  WorkItemStatus,
} from "../domain/types";
import type { TeamworkGraphClient } from "./client";
import { looksLikePermissionFailure, withTimeout } from "./client";
import type { CoverageEntry, SourceId } from "./coverage";
import { entry } from "./coverage";
import { edgesOf } from "./edges";
import { probeAccess } from "./probe";
import { clampPageSize, ENRICHED_ITEM_LIMIT, QUERIES } from "./queries";

export interface LoadOptions {
  projectKey: string;
  versionName: string;
  /** Graph ARI of the release version. Required when a query key is configured. */
  versionAri?: string;
  pageSize?: number;
  /** Account id of the caller, used only by the access probe. */
  accountId?: string;
  /** Registered persisted-query key for release scoping. */
  queryKey?: string;
}

export interface LoadedContext {
  context: ReleaseContext;
  coverage: CoverageEntry[];
  warnings: string[];
}

type Mapper<T> = (node: unknown) => T | undefined;

/**
 * Load a release in two phases.
 *
 * Phase 1 asks the graph which work items belong to the release version, through a
 * persisted Cypher query — the only way to traverse version → work item, because
 * `JiraWorkItem` carries no fix-version field.
 *
 * Phase 2 enriches each item with its development artefacts (pull requests,
 * deployments) and recent comments. Those are per-item curated queries, so the
 * number of items enriched is bounded and the remainder is reported as unread
 * rather than silently dropped.
 */
export async function loadReleaseContext(
  client: TeamworkGraphClient,
  options: LoadOptions,
): Promise<LoadedContext> {
  const first = clampPageSize(options.pageSize);
  const warnings: string[] = [];
  const empty = emptyContext(options);

  // Without a registered query there is no way to ask the graph about a release.
  // Saying so is better than reporting an empty but "successful" read.
  if (!options.queryKey) {
    return {
      ...empty,
      coverage: [
        entry(
          "workItems",
          "unavailable",
          "No release-scope query is registered for this app yet, so the Teamwork Graph cannot be asked which work items belong to a version.",
        ),
      ],
    };
  }

  // The graph filters nodes on `ari` only, so without one the query cannot be aimed
  // at a release. That is a resolution failure, not an empty release.
  if (!options.versionAri) {
    return {
      ...empty,
      coverage: [
        entry(
          "workItems",
          "unavailable",
          `Release ${options.versionName} could not be found in project ${options.projectKey}, so the Teamwork Graph was never asked which work items belong to it.`,
        ),
      ],
    };
  }

  const scope = await run(
    client,
    "workItems",
    QUERIES.releaseScope,
    {
      queryKey: options.queryKey,
      queryParams: { versionAri: options.versionAri },
      first,
    },
    normaliseWorkItem,
    cypherNodes,
  );

  if (scope.entry.status === "unavailable") {
    return { ...empty, coverage: [scope.entry] };
  }

  // An empty result is ambiguous: no work in scope, or no permission to read it.
  // The probe only runs on a *successful but empty* answer: a refusal already says
  // what it is, and letting the probe relabel it would turn a denial into an all-clear.
  const workItemsCoverage =
    scope.items.length === 0 && scope.entry.status === "empty"
      ? await resolveEmpty(client, scope.entry, options.accountId)
      : scope.entry;

  const items = scope.items;
  const enrichable = items.filter((item) => item.graphId !== undefined);
  const toEnrich = enrichable.slice(0, ENRICHED_ITEM_LIMIT);

  if (enrichable.length > toEnrich.length) {
    warnings.push(
      `Only the ${toEnrich.length} most recently updated of ${enrichable.length} work items had their pull requests, deployments and comments read.`,
    );
  }

  const enriched = await Promise.all(
    toEnrich.map(async (item) => ({
      key: item.key,
      ...(await readItemDetail(client, item.graphId as string, first)),
    })),
  );

  const pullRequests = enriched.flatMap((detail) =>
    detail.pullRequests.map((pr) => ({ ...pr, workItemKey: detail.key })),
  );
  const deployments = enriched.flatMap((detail) =>
    detail.deployments.map((deployment) => ({ ...deployment, workItemKey: detail.key })),
  );
  const reviewSignals = enriched.flatMap((detail) =>
    detail.reviewSignals.map((signal) => ({ ...signal, workItemKey: detail.key })),
  );

  return {
    context: {
      projectKey: options.projectKey,
      versionName: options.versionName,
      workItems: items,
      pullRequests,
      deployments,
      reviewSignals,
    },
    coverage: [
      workItemsCoverage,
      detailCoverage("pullRequests", enriched, (detail) => detail.pullRequests.length, "linked pull requests", items.length),
      detailCoverage("deployments", enriched, (detail) => detail.deployments.length, "deployments", items.length),
      detailCoverage("reviewSignals", enriched, (detail) => detail.reviewSignals.length, "review comments", items.length),
    ],
    warnings,
  };
}

interface ItemDetail {
  pullRequests: LinkedPullRequest[];
  deployments: LinkedDeployment[];
  reviewSignals: ReviewSignal[];
  failed: number;
}

async function readItemDetail(
  client: TeamworkGraphClient,
  id: string,
  first: number,
): Promise<ItemDetail> {
  const [artifacts, comments] = await Promise.all([
    queryOnce(client, QUERIES.developmentArtifacts, { id, first }),
    queryOnce(client, QUERIES.comments, { id, first }),
  ]);

  const detail: ItemDetail = { pullRequests: [], deployments: [], reviewSignals: [], failed: 0 };

  if (artifacts === undefined) detail.failed += 1;
  else {
    for (const node of edgesOf(artifacts)) {
      const record = asRecord(node);
      const type = asString(record.__typename);
      if (type === "ExternalPullRequest") {
        const pr = normalisePullRequest(record);
        if (pr) detail.pullRequests.push(pr);
      } else if (type === "ExternalDeployment") {
        const deployment = normaliseDeployment(record);
        if (deployment) detail.deployments.push(deployment);
      }
    }
  }

  if (comments === undefined) detail.failed += 1;
  else {
    for (const node of edgesOf(comments)) {
      const signal = normaliseReviewSignal(asRecord(node));
      if (signal) detail.reviewSignals.push(signal);
    }
  }

  return detail;
}

async function queryOnce(
  client: TeamworkGraphClient,
  document: string,
  variables: Record<string, unknown>,
): Promise<unknown | undefined> {
  try {
    const result = await withTimeout(client.request<unknown>(document, variables), "detail");
    return result.errors.length > 0 ? undefined : result.data;
  } catch {
    return undefined;
  }
}

/**
 * Per-source coverage for the enrich phase.
 *
 * `read` means the queries ran and between them returned at least one item. `empty`
 * means they ran and returned nothing — on a site with no SCM or CI connected that
 * is the normal, expected answer, and it is not evidence of safety.
 */
function detailCoverage(
  source: SourceId,
  details: ItemDetail[],
  countOf: (detail: ItemDetail) => number,
  label: string,
  itemCount: number,
): CoverageEntry {
  if (details.length === 0) {
    return entry(
      source,
      "empty",
      itemCount === 0 ? "There were no work items to look for this in." : `No ${label} to read.`,
    );
  }

  const found = details.reduce((total, detail) => total + countOf(detail), 0);
  if (found > 0) return entry(source, "read");

  // Every per-item query failing is not the same as every item having nothing:
  // one is a broken source, the other is a real answer, and they must not look alike.
  const failures = details.reduce((total, detail) => total + detail.failed, 0);
  if (failures > 0) {
    return entry(
      source,
      "unavailable",
      failures === details.length * 2
        ? `${label} could not be read: every request failed.`
        : `${label} could only be read for some work items; the rest are unknown.`,
    );
  }

  return entry(source, "empty", `No ${label} were linked to the work items in this release.`);
}

function emptyContext(options: LoadOptions): LoadedContext {
  return {
    context: {
      projectKey: options.projectKey,
      versionName: options.versionName,
      workItems: [],
      pullRequests: [],
      deployments: [],
      reviewSignals: [],
    },
    coverage: [],
    warnings: [],
  };
}

async function resolveEmpty(
  client: TeamworkGraphClient,
  original: CoverageEntry,
  accountId: string | undefined,
): Promise<CoverageEntry> {
  if (!accountId) return original;

  const probe = await probeAccess(client, accountId);
  if (probe.status === "read" || probe.status === "empty") {
    return entry(
      "workItems",
      "empty",
      "The user's own assigned work items were readable, so this release really has no items in scope.",
    );
  }

  return entry(
    "workItems",
    probe.status,
    probe.detail ??
      "No work items were returned and the access probe could not confirm read access, so emptiness is not evidence of safety.",
  );
}

interface SourceRun<T> {
  items: T[];
  entry: CoverageEntry;
}

async function run<T>(
  client: TeamworkGraphClient,
  source: SourceId,
  document: string,
  variables: Record<string, unknown>,
  map: Mapper<T>,
  extract: (payload: unknown) => unknown[] = edgesOf,
): Promise<SourceRun<T>> {
  try {
    const result = await withTimeout(client.request<unknown>(document, variables), source);

    if (result.errors.length > 0) {
      const status = looksLikePermissionFailure(result.errors) ? "not_permitted" : "unavailable";
      return {
        items: [],
        entry: entry(source, status, result.errors[0]?.message ?? "query failed"),
      };
    }

    // fallow-ignore-next-line complexity
    const items = extract(result.data)
      .map(map)
      .filter((item): item is T => item !== undefined);

    return { items, entry: entry(source, items.length > 0 ? "read" : "empty") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { items: [], entry: entry(source, "unavailable", message) };
  }
}

/**
 * Pull the hydrated nodes out of a Cypher connection.
 *
 * Shape: `customQuery.edges[].node.columns[].value`, where a selected object column
 * is a `CypherQueryResultNode` carrying `data`.
 */
export function cypherNodes(payload: unknown): unknown[] {
  // `edgesOf` walks the top-level payload looking for a connection, so it is handed
  // the payload itself rather than the `customQuery` field.
  const rows = edgesOf(payload);

  return rows.flatMap((row) => {
    const columns = asArray(asRecord(row).columns);
    for (const column of columns) {
      const value = asRecord(asRecord(column).value);
      if (asString(value.__typename) === "CypherQueryResultNode") {
        const data = asRecord(value.data);
        return data.__typename === undefined ? [] : [data];
      }
    }
    return [];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Status is a category, not a name: sites rename "To Do" to "Parked" all the time,
 * but the category key (new / indeterminate / done) is stable.
 */
function normaliseStatus(node: Record<string, unknown>): WorkItemStatus {
  const status = asRecord(node.status);
  const category = asString(asRecord(status.statusCategory).key)?.toLowerCase();
  if (category === "done") return "done";
  if (category === "indeterminate") return "in_progress";
  if (category === "new") return "todo";

  const name = (asString(status.name) ?? "").toLowerCase();
  if (name.includes("done") || name.includes("closed") || name.includes("resolved")) return "done";
  if (name.includes("progress") || name.includes("review")) return "in_progress";
  if (name.includes("to do") || name.includes("todo") || name.includes("open")) return "todo";
  return "unknown";
}

function normaliseWorkItem(node: unknown): WorkItem | undefined {
  const record = asRecord(node);
  const key = asString(record.key);
  if (!key) return undefined;

  const graphId = asString(record.id);
  const resolvedAt = asString(record.resolvedAt);
  const statusName = asString(asRecord(record.status).name);

  // The graph has no "blocked" field. Sites express blocking through workflow, so a
  // status whose name says so is the only signal available — better than dropping
  // the rule, and it is reported as a status, not as a flag the data does not have.
  const blockedReason =
    asString(record.blockedReason) ??
    (statusName !== undefined && statusName.toLowerCase().includes("blocked")
      ? `Status is "${statusName}"`
      : undefined);

  return {
    key,
    summary: asString(record.summary) ?? "(no summary)",
    status: normaliseStatus(record),
    issueType: asString(asRecord(record.issueType).name) ?? "Work item",
    ...(asString(record.webUrl) ? { url: asString(record.webUrl) } : {}),
    ...(graphId ? { graphId } : {}),
    ...(blockedReason ? { blockedReason } : {}),
    ...(resolvedAt ? { updatedAt: resolvedAt } : {}),
  };
}

function normalisePullRequest(node: Record<string, unknown>): LinkedPullRequest | undefined {
  const id = asString(node.id);
  if (!id) return undefined;

  const status = (asString(node.status) ?? "").toUpperCase();
  const state =
    status === "MERGED"
      ? "merged"
      : status === "DECLINED"
        ? "declined"
        : status === "OPEN" || status === "DRAFT"
          ? "open"
          : "unknown";

  const approvals = asArray(node.reviewers).map((reviewer) =>
    (asString(asRecord(reviewer).approvalStatus) ?? "").toUpperCase(),
  );
  const reviewDecision = approvals.includes("NEEDSWORK")
    ? "changes_requested"
    : approvals.includes("APPROVED")
      ? "approved"
      : approvals.length > 0
        ? "pending"
        : "unknown";

  return {
    id,
    title: asString(node.title) ?? asString(node.displayName) ?? id,
    state,
    reviewDecision,
    ...(asString(node.url) ? { url: asString(node.url) } : {}),
  };
}

function normaliseDeployment(node: Record<string, unknown>): LinkedDeployment | undefined {
  const id = asString(node.id);
  if (!id) return undefined;

  const state = (asString(node.state) ?? "").toUpperCase();
  const status =
    state === "FAILED" || state === "ROLLED_BACK" || state === "CANCELLED"
      ? "failed"
      : state === "SUCCESSFUL"
        ? "successful"
        : state === "IN_PROGRESS" || state === "PENDING"
          ? "running"
          : "unknown";

  return {
    id,
    environment:
      asString(asRecord(node.environment).displayName) ??
      asString(asRecord(node.environment).type) ??
      asString(node.displayName) ??
      "unknown",
    status,
    ...(asString(node.url) ? { url: asString(node.url) } : {}),
  };
}

function normaliseReviewSignal(node: Record<string, unknown>): ReviewSignal | undefined {
  const id = asString(node.id);
  if (!id) return undefined;

  const content = asString(node.content) ?? "";
  const createdAt = asString(node.createdAt);

  return {
    kind: "unresolved_comment",
    workItemKey: id,
    detail: content.length > 0 ? truncate(content, 160) : createdAt ? `Comment from ${createdAt}` : "Open comment",
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
