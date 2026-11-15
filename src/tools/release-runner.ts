import type { TeamworkGraphClient } from "../graph/client";
import { persistedQueryKey } from "../graph/config";
import { caveat } from "../graph/coverage";
import { createForgeGraphClient } from "../graph/forge-client";
import type { LoadedContext } from "../graph/load";
import { loadReleaseContext } from "../graph/load";
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
}

export function defaultDeps(): Deps {
  return { client: createForgeGraphClient() };
}

export type Answer = (loaded: LoadedContext, request: ReleaseRequest) => ToolResult;

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

  const loaded = await loadReleaseContext(deps.client, {
    projectKey: parsed.request.projectKey,
    versionName: parsed.request.versionName,
    ...(accountId === undefined ? {} : { accountId }),
    ...(queryKey === undefined ? {} : { queryKey }),
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
