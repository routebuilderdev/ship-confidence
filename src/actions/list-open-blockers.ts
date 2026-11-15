import { collectRiskFactors } from "../domain/readiness";
import { buildResult, type ToolResult } from "../tools/result";
import { answerReleaseQuestion, defaultDeps, type Deps } from "../tools/release-runner";

/**
 * `list-open-blockers` — the drill-down after a bad verdict.
 *
 * Deliberately narrow: it returns only blocker-severity factors, so an agent
 * asked "what is in the way" does not answer with a wall of warnings.
 */
export async function run(payload: unknown, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return answerReleaseQuestion(payload, deps, (loaded, request) => {
    const blockers = collectRiskFactors(loaded.context).filter(
      (factor) => factor.severity === "blocker",
    );

    const summary =
      blockers.length === 0
        ? `No blockers found for ${request.projectKey} ${request.versionName}.`
        : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} holding back ${request.projectKey} ${request.versionName}: ${blockers
            .map((factor) => factor.title)
            .join("; ")}.`;

    return buildResult({
      ok: true,
      summary,
      coverage: loaded.coverage,
      warnings: loaded.warnings,
      data: { blockers },
    });
  });
}

export const handler = (payload: unknown): Promise<ToolResult> => run(payload);
