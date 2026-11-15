import type { ReleaseContext } from "./types";

export type Severity = "blocker" | "warning" | "info";

export interface RiskFactor {
  /** Stable identifier so an agent (and our tests) can refer to a factor by name. */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  workItemKey?: string;
  /** How much this factor subtracts from 100. Kept next to the rule, not in a table. */
  penalty: number;
}

export type Verdict = "ship" | "ship_with_risk" | "do_not_ship" | "unverified";

/** A single check. Each rule is pure and independently testable. */
type Rule = (ctx: ReleaseContext) => RiskFactor[];

const UNFINISHED: Rule = (ctx) =>
  ctx.workItems
    .filter((item) => item.status !== "done" && item.status !== "unknown")
    .map((item) => ({
      id: `unfinished-work-item:${item.key}`,
      severity: "blocker" as const,
      title: `${item.key} is not done`,
      detail: `Work item is still ${describeStatus(item.status)} but is in scope for ${ctx.versionName}.`,
      workItemKey: item.key,
      penalty: 15,
    }));

const EXPLICITLY_BLOCKED: Rule = (ctx) =>
  ctx.workItems
    .filter((item) => Boolean(item.blockedReason))
    .map((item) => ({
      id: `blocked-work-item:${item.key}`,
      severity: "blocker" as const,
      title: `${item.key} is flagged as blocked`,
      detail: item.blockedReason ?? "",
      workItemKey: item.key,
      penalty: 20,
    }));

const OPEN_PULL_REQUEST: Rule = (ctx) =>
  ctx.pullRequests
    .filter((pr) => pr.state === "open")
    .map((pr) => ({
      id: `open-pull-request:${pr.id}`,
      severity: "blocker" as const,
      title: `Pull request still open: ${pr.title}`,
      detail: pr.workItemKey
        ? `Linked to ${pr.workItemKey}. Work may be marked done while the code is not merged.`
        : "Code is not merged yet.",
      ...(pr.workItemKey ? { workItemKey: pr.workItemKey } : {}),
      penalty: 20,
    }));

const FAILED_DEPLOYMENT: Rule = (ctx) => {
  const [latest, ...older] = ctx.deployments.filter((d) => d.status === "failed");
  if (!latest) return [];
  const extra = older.length > 0 ? ` ${older.length} earlier failure(s) also recorded.` : "";
  return [
    {
      id: `failed-deployment:${latest.id}`,
      severity: "blocker" as const,
      title: `Last deployment to ${latest.environment} failed`,
      detail: `A failed deployment is evidence the release has not shipped successfully.${extra}`,
      ...(latest.workItemKey ? { workItemKey: latest.workItemKey } : {}),
      penalty: 25,
    },
  ];
};

const UNRESOLVED_REVIEW: Rule = (ctx) =>
  ctx.reviewSignals
    .filter((signal) => signal.kind === "unresolved_comment")
    .map((signal) => ({
      id: `unresolved-comment:${signal.workItemKey}`,
      severity: "warning" as const,
      title: `Unresolved review comment on ${signal.workItemKey}`,
      detail: signal.detail,
      workItemKey: signal.workItemKey,
      penalty: 8,
    }));

const CHANGES_REQUESTED: Rule = (ctx) =>
  ctx.pullRequests
    .filter((pr) => pr.reviewDecision === "changes_requested")
    .map((pr) => ({
      id: `changes-requested:${pr.id}`,
      severity: "warning" as const,
      title: `Changes requested on ${pr.title}`,
      detail: "A reviewer asked for changes and the pull request has not been re-approved.",
      ...(pr.workItemKey ? { workItemKey: pr.workItemKey } : {}),
      penalty: 10,
    }));

const STALE_WORK: Rule = (ctx) => {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return ctx.workItems
    .filter((item) => item.status !== "done" && item.updatedAt)
    .filter((item) => {
      const updated = Date.parse(item.updatedAt ?? "");
      return Number.isFinite(updated) && updated < cutoff;
    })
    .map((item) => ({
      id: `stale-work-item:${item.key}`,
      severity: "info" as const,
      title: `${item.key} has not moved in two weeks`,
      detail: "No update recorded in the last 14 days.",
      workItemKey: item.key,
      penalty: 3,
    }));
};

/** Ordered so that the UI and the agent both see blockers first. */
const RULES: Rule[] = [
  FAILED_DEPLOYMENT,
  EXPLICITLY_BLOCKED,
  OPEN_PULL_REQUEST,
  UNFINISHED,
  CHANGES_REQUESTED,
  UNRESOLVED_REVIEW,
  STALE_WORK,
];

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };

function describeStatus(status: string): string {
  switch (status) {
    case "todo":
      return "to do";
    case "in_progress":
      return "in progress";
    default:
      return "in an unknown state";
  }
}

/** Pure: same context in, same report out. No clock except the explicit stale rule. */
export function collectRiskFactors(ctx: ReleaseContext): RiskFactor[] {
  return RULES.flatMap((rule) => rule(ctx)).sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : b.penalty - a.penalty;
  });
}

export interface ReadinessReport {
  verdict: Verdict;
  score: number;
  riskFactors: RiskFactor[];
  counts: { workItems: number; done: number; blockers: number; warnings: number };
}

const BLOCKER_SCORE_CAP = 59;

export function scoreReadiness(ctx: ReleaseContext): ReadinessReport {
  const riskFactors = collectRiskFactors(ctx);
  const counts = {
    workItems: ctx.workItems.length,
    done: ctx.workItems.filter((item) => item.status === "done").length,
    blockers: riskFactors.filter((f) => f.severity === "blocker").length,
    warnings: riskFactors.filter((f) => f.severity === "warning").length,
  };

  // No work items at all is not "nothing to worry about", it is "I could not see
  // the release". This is the single most important branch in the app.
  if (counts.workItems === 0) {
    return { verdict: "unverified", score: 0, riskFactors, counts };
  }

  const rawScore = riskFactors.reduce((score, factor) => score - factor.penalty, 100);
  const capped = counts.blockers > 0 ? Math.min(rawScore, BLOCKER_SCORE_CAP) : rawScore;
  const score = Math.max(0, Math.min(100, capped));

  return { verdict: verdictFor(score), score, riskFactors, counts };
}

function verdictFor(score: number): Verdict {
  if (score >= 85) return "ship";
  if (score >= 60) return "ship_with_risk";
  return "do_not_ship";
}

/** Shared by every tool so all of them speak the same sentence. */
export function summarise(report: ReadinessReport, ctx: ReleaseContext): string {
  const { verdict, score, counts } = report;

  if (verdict === "unverified") {
    return `I found no work items in scope for ${ctx.projectKey} ${ctx.versionName} in the data I could read, so I cannot say whether it is ready. This is unknown, not clear.`;
  }

  const blockerPart =
    counts.blockers > 0
      ? `${counts.blockers} blocker${counts.blockers === 1 ? "" : "s"} (${report.riskFactors
          .filter((f) => f.severity === "blocker")
          .map((f) => f.title)
          .join("; ")})`
      : "no blockers";

  const head =
    verdict === "ship"
      ? `${ctx.projectKey} ${ctx.versionName} looks safe to ship.`
      : verdict === "ship_with_risk"
        ? `${ctx.projectKey} ${ctx.versionName} can ship, but with open risk.`
        : `${ctx.projectKey} ${ctx.versionName} is not ready to ship.`;

  return `${head} Score ${score}/100, ${blockerPart}. ${counts.done}/${counts.workItems} work items done.`;
}
