import { scoreReadiness } from "../domain/readiness";
import { toPageView, type PageView } from "../frontend/view";
import { persistedQueryKey } from "../graph/config";
import { loadReleaseContext } from "../graph/load";
import type { Deps } from "./release-runner";

/**
 * The project page asks the same question as `get-release-readiness`, through the
 * same loader and the same scorer. Only the output shape differs, so a score shown
 * on the page can never disagree with the score an agent quotes in chat.
 */

export type PageRequest =
  | { kind: "ok"; projectKey: string; versionName: string }
  | { kind: "missing"; missing: string[] };

export interface PageRequestInput {
  payload: unknown;
  /** `context.extension.project.key` for a Jira project page. Preferred over payload. */
  contextProjectKey?: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * The project key comes from the page context first: a page can only ever show its
 * own project, and context cannot be spoofed by the browser the way a payload can.
 */
export function parsePageRequest(input: PageRequestInput): PageRequest {
  const payload = readRecord(input.payload);
  const projectKey = input.contextProjectKey ?? readString(payload.projectKey);
  const versionName = readString(payload.versionName);

  const missing: string[] = [];
  if (!projectKey) missing.push("projectKey");
  if (!versionName) missing.push("versionName");
  if (!projectKey || !versionName) return { kind: "missing", missing };

  return { kind: "ok", projectKey, versionName };
}

export async function buildPageView(
  deps: Deps,
  request: { projectKey: string; versionName: string; accountId?: string },
): Promise<PageView> {
  const queryKey = persistedQueryKey();

  const loaded = await loadReleaseContext(deps.client, {
    projectKey: request.projectKey,
    versionName: request.versionName,
    ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
    ...(queryKey === undefined ? {} : { queryKey }),
  });

  const report = scoreReadiness(loaded.context);

  return toPageView({
    projectKey: request.projectKey,
    versionName: request.versionName,
    report,
    coverage: loaded.coverage,
    warnings: loaded.warnings,
    workItems: loaded.context.workItems,
  });
}

/** The caller's identity, from the resolver context (never from the browser payload). */
export function accountIdFromContext(context: unknown): string | undefined {
  return readString(readRecord(context).accountId);
}

/** Narrowing helper for the resolver's opaque `context`. */
export function projectKeyFromContext(context: unknown): string | undefined {
  const extension = readRecord(readRecord(context).extension);
  const jira = readRecord(extension.jira);
  const project = readRecord(extension.project);
  const confluence = readRecord(extension.confluence);

  return (
    readString(project.key) ??
    readString(jira.projectKey) ??
    readString(readRecord(project.project).key) ??
    readString(confluence.spaceKey)
  );
}
