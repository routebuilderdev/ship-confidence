import type { CoverageEntry, CoverageStatus } from "../graph/coverage";
import { caveat, SOURCE_LABELS } from "../graph/coverage";
import type { ReadinessReport, RiskFactor, Severity, Verdict } from "../domain/readiness";
import { nextAction } from "../domain/readiness";
import type { WorkItem } from "../domain/types";

/**
 * The Jira project page's view model.
 *
 * Pure, like `domain`: it takes an already-computed report and returns exactly
 * what the UI Kit component renders. Keeping the copy and the tone mapping here
 * means the page, the MCP tools and the tests all describe a release the same
 * way, and the JSX stays free of conditional prose.
 */

export type PageTone = "success" | "warning" | "critical" | "unknown";

export interface FactorView {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  penalty: number;
  workItemKey?: string;
  url?: string;
}

export interface CoverageView {
  source: CoverageEntry["source"];
  label: string;
  status: CoverageStatus;
  tone: PageTone;
  detail?: string;
}

export interface PageView {
  projectKey: string;
  versionName: string;
  verdict: Verdict;
  verdictLabel: string;
  tone: PageTone;
  score: number;
  countLine: string;
  nextStep: string;
  /** The completeness sentence, shown above the factors. Absent when complete. */
  notice?: string;
  factors: FactorView[];
  /** True when the list was cut, so the page does not imply it is complete. */
  factorsTruncated: boolean;
  coverage: CoverageView[];
  warnings: string[];
}

export const MAX_VISIBLE_FACTORS = 8;

export interface PageViewInput {
  projectKey: string;
  versionName: string;
  report: ReadinessReport;
  coverage: CoverageEntry[];
  warnings: string[];
  workItems: WorkItem[];
}

export function toPageView(input: PageViewInput): PageView {
  const { report, coverage, workItems } = input;
  const urls = new Map(
    workItems.filter((item) => item.url !== undefined).map((item) => [item.key, item.url as string]),
  );

  const factors = report.riskFactors
    .slice(0, MAX_VISIBLE_FACTORS)
    .map((factor) => toFactor(factor, urls));
  const notice = noticeOf(coverage, input.warnings);

  return {
    projectKey: input.projectKey,
    versionName: input.versionName,
    verdict: report.verdict,
    verdictLabel: verdictLabel(report.verdict),
    tone: verdictTone(report.verdict),
    score: report.score,
    countLine: countLine(report),
    nextStep: nextStep(report, coverage),
    ...(notice === undefined ? {} : { notice }),
    factors,
    factorsTruncated: report.riskFactors.length > MAX_VISIBLE_FACTORS,
    coverage: coverage.map(toCoverageView),
    warnings: input.warnings,
  };
}

/** The caveat is the honesty sentence; a plain warning fills in if there is one. */
function noticeOf(coverage: CoverageEntry[], warnings: string[]): string | undefined {
  return caveat(coverage) ?? warnings[0];
}

function toFactor(factor: RiskFactor, urls: Map<string, string>): FactorView {
  const url = factor.workItemKey === undefined ? undefined : urls.get(factor.workItemKey);
  return {
    id: factor.id,
    title: factor.title,
    detail: factor.detail,
    severity: factor.severity,
    penalty: factor.penalty,
    ...(factor.workItemKey === undefined ? {} : { workItemKey: factor.workItemKey }),
    ...(url === undefined ? {} : { url }),
  };
}

export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "ship":
      return "Ready to ship";
    case "ship_with_risk":
      return "Shippable with risk";
    case "do_not_ship":
      return "Not ready to ship";
    case "unverified":
      return "Unverified";
  }
}

export function verdictTone(verdict: Verdict): PageTone {
  switch (verdict) {
    case "ship":
      return "success";
    case "ship_with_risk":
      return "warning";
    case "do_not_ship":
      return "critical";
    case "unverified":
      return "unknown";
  }
}

function countLine(report: ReadinessReport): string {
  const { workItems, done, blockers, warnings } = report.counts;
  const parts = [`${done}/${workItems} work items done`];
  parts.push(blockers === 0 ? "no blockers" : `${blockers} blocker${blockers === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * The page always ends with something to do. "Not ready" without a next action is
 * a dashboard; a release gate tells you which thing to unblock next.
 */
function nextStep(report: ReadinessReport, coverage: CoverageEntry[]): string {
  const denied = coverage.some((entry) => entry.status === "not_permitted");
  return nextAction(report, denied);
}

export function toCoverageView(entry: CoverageEntry): CoverageView {
  return {
    source: entry.source,
    label: SOURCE_LABELS[entry.source],
    status: entry.status,
    tone: coverageTone(entry.status),
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  };
}

function coverageTone(status: CoverageStatus): PageTone {
  switch (status) {
    case "read":
      return "success";
    case "empty":
      return "unknown";
    case "not_permitted":
    case "unavailable":
      return "critical";
  }
}
