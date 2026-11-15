import { describe, expect, it } from "vitest";

import { collectRiskFactors, scoreReadiness, summarise } from "../src/domain/readiness";
import type { ReleaseContext } from "../src/domain/types";

function context(overrides: Partial<ReleaseContext> = {}): ReleaseContext {
  return {
    projectKey: "SHIP",
    versionName: "2.4.0",
    workItems: [],
    pullRequests: [],
    deployments: [],
    reviewSignals: [],
    ...overrides,
  };
}

const doneItem = {
  key: "SHIP-1",
  summary: "Ship it",
  status: "done" as const,
  issueType: "Story",
};

describe("scoreReadiness", () => {
  it("reports unverified rather than clear when nothing is readable", () => {
    const report = scoreReadiness(context());
    expect(report.verdict).toBe("unverified");
    expect(report.score).toBe(0);
    expect(summarise(report, context())).toContain("unknown, not clear");
  });

  it("gives a clean release a full score", () => {
    const report = scoreReadiness(context({ workItems: [doneItem, { ...doneItem, key: "SHIP-2" }] }));
    expect(report).toMatchObject({ verdict: "ship", score: 100 });
    expect(report.counts).toEqual({ workItems: 2, done: 2, blockers: 0, warnings: 0 });
  });

  it("caps the score below 60 whenever a blocker exists", () => {
    const report = scoreReadiness(
      context({ workItems: [{ ...doneItem, blockedReason: "Waiting on legal" }] }),
    );
    expect(report.score).toBeLessThanOrEqual(59);
    expect(report.verdict).toBe("do_not_ship");
    expect(report.riskFactors[0]?.id).toBe("blocked-work-item:SHIP-1");
  });

  it("treats an open pull request on a done item as a blocker", () => {
    const report = scoreReadiness(
      context({
        workItems: [doneItem],
        pullRequests: [
          { id: "pr-1", title: "Not merged yet", state: "open", workItemKey: "SHIP-1" },
        ],
      }),
    );
    expect(report.verdict).toBe("do_not_ship");
    expect(report.riskFactors.some((f) => f.id === "open-pull-request:pr-1")).toBe(true);
  });

  it("keeps a single unresolved review comment as a warning, not a blocker", () => {
    const report = scoreReadiness(
      context({
        workItems: [doneItem],
        reviewSignals: [
          { kind: "unresolved_comment", workItemKey: "SHIP-1", detail: "Needs a test" },
        ],
      }),
    );
    expect(report.counts.warnings).toBe(1);
    expect(report.counts.blockers).toBe(0);
    expect(report.verdict).toBe("ship");
    expect(report.score).toBe(92);
  });

  it("surfaces only the latest failed deployment as the blocker", () => {
    const factors = collectRiskFactors(
      context({
        workItems: [doneItem],
        deployments: [
          { id: "dep-1", environment: "prod", status: "failed" },
          { id: "dep-2", environment: "prod", status: "failed" },
        ],
      }),
    );
    const deploymentFactors = factors.filter((f) => f.severity === "blocker");
    expect(deploymentFactors).toHaveLength(1);
    expect(deploymentFactors[0]?.detail).toContain("1 earlier failure");
  });

  it("orders blockers before warnings before info", () => {
    const factors = collectRiskFactors(
      context({
        workItems: [
          { ...doneItem, status: "todo", updatedAt: "2020-01-01T00:00:00Z" },
          { ...doneItem, key: "SHIP-9", blockedReason: "Blocked" },
        ],
        reviewSignals: [
          { kind: "unresolved_comment", workItemKey: "SHIP-9", detail: "Comment" },
        ],
      }),
    );
    const severities = factors.map((f) => f.severity);
    const firstWarning = severities.indexOf("warning");
    expect(severities.slice(0, firstWarning).every((s) => s === "blocker")).toBe(true);
  });

  it("never returns a score outside 0-100", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...doneItem,
      key: `SHIP-${index}`,
      status: "todo" as const,
      blockedReason: "Blocked",
    }));
    const report = scoreReadiness(context({ workItems: many }));
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});
