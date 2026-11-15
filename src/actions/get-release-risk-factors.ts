import { collectRiskFactors } from "../domain/readiness";
import { buildResult, type ToolResult } from "../tools/result";
import { answerReleaseQuestion, defaultDeps, type Deps } from "../tools/release-runner";

/**
 * `get-release-risk-factors` — everything, ranked.
 *
 * Exists separately from `list-open-blockers` because "why did the score drop"
 * and "what is stopping this release" are different questions with different
 * answers; a single tool with a mode flag would make the model guess.
 */
export async function run(payload: unknown, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return answerReleaseQuestion(payload, deps, (loaded, request) => {
    const riskFactors = collectRiskFactors(loaded.context);
    const bySeverity = {
      blocker: riskFactors.filter((factor) => factor.severity === "blocker").length,
      warning: riskFactors.filter((factor) => factor.severity === "warning").length,
      info: riskFactors.filter((factor) => factor.severity === "info").length,
    };

    const summary =
      riskFactors.length === 0
        ? `No risk factors found for ${request.projectKey} ${request.versionName}.`
        : `${riskFactors.length} risk factor${riskFactors.length === 1 ? "" : "s"} for ${request.projectKey} ${request.versionName}: ${bySeverity.blocker} blocker, ${bySeverity.warning} warning, ${bySeverity.info} informational.`;

    return buildResult({
      ok: true,
      summary,
      coverage: loaded.coverage,
      warnings: loaded.warnings,
      data: { riskFactors, bySeverity },
    });
  });
}

export const handler = (payload: unknown): Promise<ToolResult> => run(payload);
