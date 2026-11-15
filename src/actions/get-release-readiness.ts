import { scoreReadiness, summarise } from "../domain/readiness";
import { buildResult, type ToolResult } from "../tools/result";
import { answerReleaseQuestion, defaultDeps, type Deps } from "../tools/release-runner";

/**
 * `get-release-readiness` — the headline tool.
 *
 * Manifest binding: `function: getReleaseReadiness` →
 * `handler: actions/get-release-readiness.handler`.
 */
export async function run(payload: unknown, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return answerReleaseQuestion(payload, deps, (loaded, request) => {
    const report = scoreReadiness(loaded.context);

    return buildResult({
      ok: report.verdict !== "unverified",
      summary: summarise(report, loaded.context),
      coverage: loaded.coverage,
      warnings: loaded.warnings,
      data: {
        projectKey: request.projectKey,
        versionName: request.versionName,
        verdict: report.verdict,
        score: report.score,
        counts: report.counts,
        riskFactors: report.riskFactors,
      },
    });
  });
}

/** Forge entry point. Kept a one-liner so all logic stays testable via `run`. */
export const handler = (payload: unknown): Promise<ToolResult> => run(payload);
