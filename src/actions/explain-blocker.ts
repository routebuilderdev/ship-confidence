import type { LinkedDeployment, LinkedPullRequest, ReviewSignal } from "../domain/types";
import { collectRiskFactors, type RiskFactor } from "../domain/readiness";
import { readInput } from "../tools/context";
import { buildResult, type ToolResult } from "../tools/result";
import { answerReleaseQuestion, defaultDeps, type Deps } from "../tools/release-runner";

/**
 * `explain-blocker` — one blocker, in depth, with links back to the source.
 *
 * This is the second step of the demo, and the reason it exists as its own tool:
 * "why is SHIP-442 blocking us" is a different question from "what is blocking
 * us", and answering it needs the work item, its pull requests, its deployments
 * and its review comments together.
 */
export async function run(payload: unknown, deps: Deps = defaultDeps()): Promise<ToolResult> {
  const blockerId = readInput(payload, "blockerId");
  const workItemKey = readInput(payload, "workItemKey");

  return answerReleaseQuestion(payload, deps, (loaded, request) => {
    const factors = collectRiskFactors(loaded.context);
    const matching = selectBlockers(factors, blockerId, workItemKey);

    if (matching.length === 0) {
      const available = factors.filter((factor) => factor.severity === "blocker");
      return buildResult({
        ok: false,
        summary:
          available.length === 0
            ? `There is no blocker matching that on ${request.projectKey} ${request.versionName}, because there are no blockers at all.`
            : `I could not find that blocker. The blockers currently recorded are: ${available
                .map((factor) => `${factor.title} (${factor.id})`)
                .join("; ")}.`,
        coverage: loaded.coverage,
        warnings: loaded.warnings,
      });
    }

    const [factor, ...rest] = matching;
    if (!factor) {
      return buildResult({ ok: false, summary: "No blocker matched.", coverage: loaded.coverage });
    }

    const item = factor.workItemKey
      ? loaded.context.workItems.find((candidate) => candidate.key === factor.workItemKey)
      : undefined;

    const context = {
      pullRequests: related(loaded.context.pullRequests, factor.workItemKey),
      deployments: related(loaded.context.deployments, factor.workItemKey),
      reviewSignals: related(loaded.context.reviewSignals, factor.workItemKey),
    };

    const link = item?.url ? ` Open it here: ${item.url}` : "";
    const alsoAffected =
      rest.length > 0
        ? ` ${rest.length} other blocker${rest.length === 1 ? " is" : "s are"} also recorded.`
        : "";

    return buildResult({
      ok: true,
      summary: `${factor.title}. ${factor.detail}${link}${alsoAffected}`,
      coverage: loaded.coverage,
      warnings: loaded.warnings,
      data: {
        blocker: factor,
        workItem: item ?? null,
        ...context,
        otherBlockers: rest,
      },
    });
  });
}

function selectBlockers(
  factors: RiskFactor[],
  blockerId: string | undefined,
  workItemKey: string | undefined,
): RiskFactor[] {
  if (!blockerId && !workItemKey) return [];

  const matched = factors.filter((factor) => {
    if (blockerId && factor.id === blockerId) return true;
    if (workItemKey && factor.workItemKey === workItemKey) return true;
    return false;
  });

  // Blockers first: if an item is both blocked and unfinished, explain the
  // stronger reason instead of the bookkeeping one.
  return matched.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "blocker" ? -1 : 1,
  );
}

function related<T extends { workItemKey?: string }>(items: T[], key: string | undefined): T[] {
  if (!key) return [];
  return items.filter((item) => item.workItemKey === key);
}

export const handler = (payload: unknown): Promise<ToolResult> => run(payload);

/** Kept for the type-level guarantee that the four context slices stay in sync. */
export type BlockerEvidence = {
  pullRequests: LinkedPullRequest[];
  deployments: LinkedDeployment[];
  reviewSignals: ReviewSignal[];
};
