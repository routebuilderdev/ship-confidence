import { describe, expect, it } from "vitest";

import { scoreReadiness } from "../src/domain/readiness";
import type { CoverageEntry } from "../src/graph/coverage";
import { MAX_VISIBLE_FACTORS, toPageView, verdictLabel, verdictTone } from "../src/frontend/view";
import type { ReleaseContext } from "../src/domain/types";
import { buildPageView, parsePageRequest, projectKeyFromContext } from "../src/tools/page-report";
import { createFakeClient, healthyRoutes, type Routes } from "./helpers/fake-client";

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

const fullCoverage: CoverageEntry[] = [
  { source: "workItems", status: "read" },
  { source: "pullRequests", status: "read" },
  { source: "deployments", status: "empty" },
  { source: "reviewSignals", status: "empty" },
];

describe("page view", () => {
  it("maps each verdict to the wording and tone the page renders", () => {
    expect(verdictLabel("ship")).toBe("Ready to ship");
    expect(verdictLabel("ship_with_risk")).toBe("Shippable with risk");
    expect(verdictLabel("do_not_ship")).toBe("Not ready to ship");
    expect(verdictLabel("unverified")).toBe("Unverified");

    expect(verdictTone("ship")).toBe("success");
    expect(verdictTone("ship_with_risk")).toBe("warning");
    expect(verdictTone("do_not_ship")).toBe("critical");
    expect(verdictTone("unverified")).toBe("unknown");
  });

  it("says nothing more than it can prove for an unreadable release", () => {
    const report = scoreReadiness(context());
    const view = toPageView({
      projectKey: "SHIP",
      versionName: "2.4.0",
      report,
      coverage: [{ source: "workItems", status: "not_permitted" }],
      warnings: [],
      workItems: [],
    });

    expect(view.verdict).toBe("unverified");
    expect(view.score).toBe(0);
    expect(view.nextStep).toContain("Teamwork Graph scopes");
    expect(view.notice).toContain("does not include work items");
  });

  it("names the first thing to unblock, not just a score", () => {
    const report = scoreReadiness(
      context({
        workItems: [
          {
            key: "SHIP-442",
            summary: "Migrate billing",
            status: "in_progress",
            issueType: "Task",
            blockedReason: "Waiting on legal",
            url: "https://example.atlassian.net/browse/SHIP-442",
          },
        ],
      }),
    );

    const view = toPageView({
      projectKey: "SHIP",
      versionName: "2.4.0",
      report,
      coverage: fullCoverage,
      warnings: [],
      workItems: [
        {
          key: "SHIP-442",
          summary: "Migrate billing",
          status: "in_progress",
          issueType: "Task",
          url: "https://example.atlassian.net/browse/SHIP-442",
        },
      ],
    });

    expect(view.tone).toBe("critical");
    expect(view.factors[0]?.workItemKey).toBe("SHIP-442");
    expect(view.factors[0]?.url).toBe("https://example.atlassian.net/browse/SHIP-442");
    expect(view.nextStep).toContain("SHIP-442");
    expect(view.nextStep).toContain("then refresh");
  });

  it("does not imply the factor list is complete when it is cut", () => {
    const workItems = Array.from({ length: MAX_VISIBLE_FACTORS + 3 }, (_, index) => ({
      key: `SHIP-${index}`,
      summary: `Item ${index}`,
      status: "in_progress" as const,
      issueType: "Task",
    }));

    const view = toPageView({
      projectKey: "SHIP",
      versionName: "2.4.0",
      report: scoreReadiness(context({ workItems })),
      coverage: fullCoverage,
      warnings: [],
      workItems,
    });

    expect(view.factors).toHaveLength(MAX_VISIBLE_FACTORS);
    expect(view.factorsTruncated).toBe(true);
  });

  it("reports each coverage source with the tone a reader can act on", () => {
    const view = toPageView({
      projectKey: "SHIP",
      versionName: "2.4.0",
      report: scoreReadiness(context()),
      coverage: [
        { source: "workItems", status: "read" },
        { source: "deployments", status: "unavailable", detail: "timeout" },
      ],
      warnings: [],
      workItems: [],
    });

    expect(view.coverage.map((entry) => entry.tone)).toEqual(["success", "critical"]);
    expect(view.coverage[1]?.detail).toBe("timeout");
  });
});

describe("page request", () => {
  it("trusts the page context over the browser payload", () => {
    const request = parsePageRequest({
      payload: { projectKey: "OTHER", versionName: "2.4.0" },
      contextProjectKey: "SHIP",
    });
    expect(request).toEqual({ kind: "ok", projectKey: "SHIP", versionName: "2.4.0" });
  });

  it("asks for the version rather than defaulting to one", () => {
    const request = parsePageRequest({ payload: {}, contextProjectKey: "SHIP" });
    expect(request).toEqual({ kind: "missing", missing: ["versionName"] });
  });

  it("finds the project key in the shapes Jira sends", () => {
    expect(projectKeyFromContext({ extension: { project: { key: "SHIP" } } })).toBe("SHIP");
    expect(projectKeyFromContext({ extension: { jira: { projectKey: "OPS" } } })).toBe("OPS");
    expect(projectKeyFromContext({})).toBeUndefined();
  });
});

describe("buildPageView", () => {
  it("shows the same verdict the tool would answer", async () => {
    const view = await buildPageView(
      { client: createFakeClient(healthyRoutes()) },
      { projectKey: "SHIP", versionName: "2.4.0" },
    );

    expect(view.verdict).toBe("ship");
    expect(view.score).toBe(100);
    expect(view.countLine).toContain("2/2 work items done");
    expect(view.factors).toEqual([]);
  });

  it("carries the partial-picture notice onto the page", async () => {
    const routes: Routes = healthyRoutes();
    routes.errors = { deployments: "Missing scope: read:graph:issue:jira" };

    const view = await buildPageView(
      { client: createFakeClient(routes) },
      { projectKey: "SHIP", versionName: "2.4.0" },
    );

    expect(view.notice).toContain("deployments");
    expect(view.coverage.find((entry) => entry.source === "deployments")?.status).toBe(
      "not_permitted",
    );
  });
});
