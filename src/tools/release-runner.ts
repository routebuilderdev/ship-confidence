import type { TeamworkGraphClient } from "../graph/client";
import { persistedQueryKey } from "../graph/config";
import { caveat } from "../graph/coverage";
import { createForgeGraphClient } from "../graph/forge-client";
import type { LoadedContext } from "../graph/load";
import { loadReleaseContext } from "../graph/load";
import { resolveVersionAri } from "../graph/versions";
import { failureResult, type ToolResult } from "./result";
import { parseReleaseRequest, type ReleaseRequest } from "./context";

/**
 * Every tool follows the same path: validate the input, load one consistent
 * picture of the release, then answer. Keeping that path here means the tools
 * differ only in the sentence they produce — which is the only part that should
 * differ.
 */
export interface Deps {
  client: TeamworkGraphClient;
  /**
   * Turns a project key + version name into a graph ARI. Injected so every layer
   * above stays testable without Jira REST, and defaulted to the real lookup.
   */
  resolveVersionAri?: (
    projectKey: string,
    versionName: string,
    cloudId: string | undefined,
  ) => Promise<string | undefined>;
}

export function defaultDeps(): Deps {
  return { client: createForgeGraphClient(), resolveVersionAri };
}

export type Answer = (loaded: LoadedContext, request: ReleaseRequest) => ToolResult;

/** Resolve the release's graph id, through the injected lookup when one is given. */
export async function resolveAri(
  deps: Deps,
  request: Pick<ReleaseRequest, "projectKey" | "versionName" | "context">,
): Promise<string | undefined> {
  const lookup = deps.resolveVersionAri ?? resolveVersionAri;
  return lookup(request.projectKey, request.versionName, request.context.cloudId);
}

export async function answerReleaseQuestion(
  payload: unknown,
  deps: Deps,
  answer: Answer,
): Promise<ToolResult> {
  const parsed = parseReleaseRequest(payload);

  if (parsed.kind === "missing") {
    return failureResult(parsed.summary);
  }

  const accountId = parsed.request.context.accountId;
  const queryKey = persistedQueryKey();
  const versionAri = await resolveAri(deps, parsed.request);

  const loaded = await loadReleaseContext(deps.client, {
    projectKey: parsed.request.projectKey,
    versionName: parsed.request.versionName,
    ...(accountId === undefined ? {} : { accountId }),
    ...(queryKey === undefined ? {} : { queryKey }),
    ...(versionAri === undefined ? {} : { versionAri }),
  });

  const warning = caveat(loaded.coverage);
  const result = answer(loaded, parsed.request);

  // Coverage caveats are appended rather than left inside `coverage` alone, so a
  // model that only reads `summary` still tells the user what it could not see.
  return warning === undefined
    ? result
    : {
        ...result,
        warnings: [...result.warnings, warning],
        summary: `${result.summary} ${warning}`,
      };
}
