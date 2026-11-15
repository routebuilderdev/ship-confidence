import type { ReadinessReport, RiskFactor, Verdict } from "./readiness";

/**
 * Comparing two releases.
 *
 * "Why is 2.5.0 worse than 2.4.0" is the question a release manager asks after the
 * verdict, and answering it needs a diff of the two reports rather than a second
 * score. Pure like the rest of `domain`: no graph access, no clock.
 */

export interface ReleaseSnapshot {
  versionName: string;
  verdict: Verdict;
  score: number;
  riskFactors: RiskFactor[];
}

export interface FactorDelta {
  /** Factors present in the baseline and gone in the candidate: something got fixed. */
  resolved: RiskFactor[];
  /** Factors that only the candidate has: something new went wrong. */
  introduced: RiskFactor[];
  /** Present in both. */
  persistent: RiskFactor[];
}

export type Direction = "better" | "worse" | "unchanged" | "unknown";

export interface ReleaseComparison {
  baseline: { versionName: string; verdict: Verdict; score: number };
  candidate: { versionName: string; verdict: Verdict; score: number };
  scoreDelta: number;
  direction: Direction;
  factors: FactorDelta;
  /** True when either side could not be read, so the diff proves nothing. */
  unverified: boolean;
}

export function snapshotOf(versionName: string, report: ReadinessReport): ReleaseSnapshot {
  return {
    versionName,
    verdict: report.verdict,
    score: report.score,
    riskFactors: report.riskFactors,
  };
}

export function compareReleases(
  baseline: ReleaseSnapshot,
  candidate: ReleaseSnapshot,
): ReleaseComparison {
  const baselineIds = new Set(baseline.riskFactors.map((factor) => factor.id));
  const candidateIds = new Set(candidate.riskFactors.map((factor) => factor.id));

  const factors: FactorDelta = {
    resolved: baseline.riskFactors.filter((factor) => !candidateIds.has(factor.id)),
    introduced: candidate.riskFactors.filter((factor) => !baselineIds.has(factor.id)),
    persistent: candidate.riskFactors.filter((factor) => baselineIds.has(factor.id)),
  };

  const scoreDelta = candidate.score - baseline.score;
  const unverified = baseline.verdict === "unverified" || candidate.verdict === "unverified";

  return {
    baseline: {
      versionName: baseline.versionName,
      verdict: baseline.verdict,
      score: baseline.score,
    },
    candidate: {
      versionName: candidate.versionName,
      verdict: candidate.verdict,
      score: candidate.score,
    },
    scoreDelta,
    // A comparison against a release we could not read is not "unchanged".
    direction: unverified ? "unknown" : directionOf(scoreDelta, factors),
    factors,
    unverified,
  };
}

function directionOf(delta: number, factors: FactorDelta): Direction {
  if (delta > 0 || (delta === 0 && factors.introduced.length === 0 && factors.resolved.length > 0)) {
    return "better";
  }
  if (delta < 0 || factors.introduced.length > 0) return "worse";
  return "unchanged";
}

/** One sentence an agent can repeat verbatim. */
export function summariseComparison(comparison: ReleaseComparison): string {
  const { baseline, candidate, scoreDelta, factors, unverified } = comparison;
  const pair = `${candidate.versionName} versus ${baseline.versionName}`;

  if (unverified) {
    const blind = [baseline, candidate]
      .filter((side) => side.verdict === "unverified")
      .map((side) => side.versionName)
      .join(" and ");
    return `I cannot compare ${pair} because ${blind} could not be read. A missing release and a clean release are not the same answer.`;
  }

  const movement =
    scoreDelta === 0
      ? `Scores are level at ${candidate.score}/100`
      : `${candidate.versionName} scores ${Math.abs(scoreDelta)} point${Math.abs(scoreDelta) === 1 ? "" : "s"} ${scoreDelta > 0 ? "higher" : "lower"} (${baseline.score} → ${candidate.score})`;

  const changes: string[] = [];
  if (factors.introduced.length > 0) {
    changes.push(
      `new: ${factors.introduced.map((factor) => factor.title).join("; ")}`,
    );
  }
  if (factors.resolved.length > 0) {
    changes.push(`fixed: ${factors.resolved.map((factor) => factor.title).join("; ")}`);
  }
  if (changes.length === 0) {
    changes.push("no risk factor changed");
  }

  const verdictPart =
    candidate.verdict === baseline.verdict
      ? `Both are ${verdictLabel(candidate.verdict)}`
      : `${baseline.versionName} is ${verdictLabel(baseline.verdict)}, ${candidate.versionName} is ${verdictLabel(candidate.verdict)}`;

  return `${movement}. ${verdictPart}. ${sentenceCase(changes.join("; "))}.`;
}

function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "ship":
      return "ready to ship";
    case "ship_with_risk":
      return "shippable with open risk";
    case "do_not_ship":
      return "not ready to ship";
    case "unverified":
      return "unreadable";
  }
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
