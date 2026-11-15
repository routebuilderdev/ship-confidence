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
import { resolveEmptyWorkItems } from "./probe";
import { clampPageSize, QUERIES } from "./queries";

export interface LoadOptions {
  projectKey: string;
  versionName: string;
  pageSize?: number;
}

export interface LoadedContext {
  context: ReleaseContext;
  coverage: CoverageEntry[];
  warnings: string[];
}

type Mapper<T> = (node: unknown) => T | undefined;

/**
 * One pass over the graph, four independent sources. A failing source degrades
 * the answer instead of failing the tool: the agent gets what is readable plus a
 * coverage record saying what is not.
 */
export async function loadReleaseContext(
  client: TeamworkGraphClient,
  options: LoadOptions,
): Promise<LoadedContext> {
  const first = clampPageSize(options.pageSize);
  const variables = { projectKey: options.projectKey, versionName: options.versionName, first };
  const warnings: string[] = [];

  // The four sources are independent, so they run concurrently. Sequentially,
  // four queries at the 12 s ceiling each would be 48 s: inside the 55 s action
  // budget but well over the project page resolver's 25 s budget.
  const [workItems, pullRequests, deployments, reviewSignals] = await Promise.all([
    run<WorkItem>(client, "workItems", QUERIES.workItems, variables, normaliseWorkItem),
    run<LinkedPullRequest>(
      client,
      "pullRequests",
      QUERIES.pullRequests,
      variables,
      normalisePullRequest,
    ),
    run<LinkedDeployment>(
      client,
      "deployments",
      QUERIES.deployments,
      variables,
      normaliseDeployment,
    ),
    run<ReviewSignal>(
      client,
      "reviewSignals",
      QUERIES.reviewSignals,
      variables,
      normaliseReviewSignal,
    ),
  ]);

  // An empty result is ambiguous: no work in scope, or no permission to read it.
  // The probe is the only way to tell the difference, and it only runs on empty.
  const workItemsCoverage =
    workItems.entry.status === "empty"
      ? await resolveEmptyWorkItems(client, workItems.entry)
      : workItems.entry;

  const { items: scopedWorkItems, versionScoped } = scopeToVersion(
    workItems.items,
    options.versionName,
  );
  if (workItems.items.length > 0 && !versionScoped) {
    warnings.push(
      `No version metadata was readable, so every work item in ${options.projectKey} was considered. Treat the score as project-wide, not version-specific.`,
    );
  }

  const linkedKeys = new Set(scopedWorkItems.map((item) => item.key));
  const inScope = <T extends { workItemKey?: string }>(item: T): boolean =>
    item.workItemKey === undefined || linkedKeys.has(item.workItemKey);

  return {
    context: {
      projectKey: options.projectKey,
      versionName: options.versionName,
      workItems: scopedWorkItems,
      pullRequests: pullRequests.items.filter(inScope),
      deployments: deployments.items.filter(inScope),
      reviewSignals: reviewSignals.items.filter((signal) => linkedKeys.has(signal.workItemKey)),
    },
    coverage: [
      workItemsCoverage,
      pullRequests.entry,
      deployments.entry,
      reviewSignals.entry,
    ],
    warnings,
  };
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

    const items = edgesOf(result.data)
      .map(map)
      .filter((item): item is T => item !== undefined);

    return { items, entry: entry(source, items.length > 0 ? "read" : "empty") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { items: [], entry: entry(source, "unavailable", message) };
  }
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

function normaliseStatus(node: Record<string, unknown>): WorkItemStatus {
  const status = node.status;
  const name = (
    typeof status === "string"
      ? status
      : (asString(asRecord(status).name) ?? asString(asRecord(status).category) ?? "")
  ).toLowerCase();

  if (name.includes("done") || name.includes("closed") || name.includes("resolved")) return "done";
  if (name.includes("progress") || name.includes("review")) return "in_progress";
  if (name.includes("to do") || name.includes("todo") || name.includes("open")) return "todo";
  return "unknown";
}

function normaliseWorkItem(node: unknown): WorkItem | undefined {
  const record = asRecord(node);
  const key = asString(record.key) ?? asString(record.issueKey);
  if (!key) return undefined;

  const versions = asArray(record.fixVersions)
    .map((version) => asString(asRecord(version).name))
    .filter((name): name is string => Boolean(name));

  return {
    key,
    summary: asString(record.summary) ?? "(no summary)",
    status: normaliseStatus(record),
    issueType: asString(asRecord(record.issueType).name) ?? asString(record.issueType) ?? "Work item",
    ...(asString(record.url) ? { url: asString(record.url) } : {}),
    ...(asString(asRecord(record.assignee).accountId)
      ? { assigneeAccountId: asString(asRecord(record.assignee).accountId) }
      : {}),
    ...(asString(record.blockedReason) ? { blockedReason: asString(record.blockedReason) } : {}),
    ...(asString(record.updatedAt) ? { updatedAt: asString(record.updatedAt) } : {}),
    ...(versions.length > 0 ? { fixVersions: versions } : {}),
  };
}

function normalisePullRequest(node: unknown): LinkedPullRequest | undefined {
  const record = asRecord(node);
  const id = asString(record.id) ?? asString(record.key);
  if (!id) return undefined;

  const rawState = (asString(record.state) ?? asString(record.status) ?? "").toLowerCase();
  const state =
    rawState.includes("merged")
      ? "merged"
      : rawState.includes("declin") || rawState.includes("closed") || rawState.includes("reject")
        ? "declined"
        : rawState.includes("open") || rawState.includes("draft")
          ? "open"
          : "unknown";

  const review = (asString(record.reviewDecision) ?? "").toLowerCase();
  const reviewDecision =
    review.includes("approved")
      ? "approved"
      : review.includes("change")
        ? "changes_requested"
        : review.length > 0
          ? "pending"
          : "unknown";

  const workItemKey = asString(record.workItemKey) ?? asString(record.parentKey);

  return {
    id,
    title: asString(record.title) ?? id,
    state,
    reviewDecision,
    ...(asString(record.url) ? { url: asString(record.url) } : {}),
    ...(workItemKey ? { workItemKey } : {}),
  };
}

function normaliseDeployment(node: unknown): LinkedDeployment | undefined {
  const record = asRecord(node);
  const id = asString(record.id) ?? asString(record.key);
  if (!id) return undefined;

  const rawStatus = (asString(record.status) ?? asString(record.state) ?? "").toLowerCase();
  const status =
    rawStatus.includes("fail") || rawStatus.includes("error")
      ? "failed"
      : rawStatus.includes("success") || rawStatus.includes("deploy")
        ? "successful"
        : rawStatus.includes("run") || rawStatus.includes("progress")
          ? "running"
          : "unknown";

  const workItemKey = asString(record.workItemKey) ?? asString(record.parentKey);

  return {
    id,
    environment: asString(record.environment) ?? asString(record.environmentName) ?? "unknown",
    status,
    ...(asString(record.url) ? { url: asString(record.url) } : {}),
    ...(workItemKey ? { workItemKey } : {}),
  };
}

function normaliseReviewSignal(node: unknown): ReviewSignal | undefined {
  const record = asRecord(node);
  const workItemKey = asString(record.workItemKey) ?? asString(record.issueKey);
  if (!workItemKey) return undefined;

  const created = asString(record.created);
  // Comments are a coarse signal: only unresolved-looking ones are surfaced, and
  // the work item they belong to decides whether they matter.
  const body = asString(record.body) ?? "";

  return {
    kind: "unresolved_comment",
    workItemKey,
    detail: body.length > 0 ? truncate(body, 160) : created ? `Comment from ${created}` : "Open comment",
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function scopeToVersion(
  items: WorkItem[],
  versionName: string,
): { items: WorkItem[]; versionScoped: boolean } {
  const withVersions = items.filter((item) => item.fixVersions !== undefined);
  if (withVersions.length === 0) {
    return { items, versionScoped: false };
  }

  const matching = withVersions.filter((item) => item.fixVersions?.includes(versionName));
  return { items: matching, versionScoped: true };
}
