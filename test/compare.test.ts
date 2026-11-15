import { describe, expect, it } from "vitest";

import { run as compare } from "../src/actions/compare-releases";
import { compareReleases, summariseComparison } from "../src/domain/compare";
import { mergeCoverage } from "../src/graph/coverage";
import { createFakeClient, healthyRoutes, type Routes } from "./helpers/fake-client";
import type { ToolResult } from "../src/tools/result";

const payload = {
  projectKey: "SHIP",
  versionName: "2.5.0",
  baselineVersionName: "2.4.0",
};

function answer(routes: Routes): Promise<ToolResult> {
  return compare(payload, { client: createFakeClient(routes) });
}

/** A release that ships cleanly. Work items carry the version they ship in. */
function cleanRelease(version = "2.4.0"): Routes {
  const routes = healthyRoutes();
  routes.workItems = (routes.workItems as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    fixVersions: [{ name: version }],
  }));
  return routes;
}

/** A release with an unfinished item and an open pull request. */
function riskyRelease(version = "2.5.0"): Routes {
  return {
    workItems: [
      {
        key: "SHIP-501",
        summary: "Rewrite checkout",
        issueType: { name: "Story" },
        status: { name: "In Progress" },
        fixVersions: [{ name: version }],
      },
      {
        key: "SHIP-502",
        summary: "Retire old flag",
        issueType: { name: "Task" },
        status: { name: "Done" },
        fixVersions: [{ name: version }],
      },
    ],
    pullRequests: [
      { id: "pr-50", title: "Checkout rewrite", state: "open", workItemKey: "SHIP-501" },
    ],
    deployments: [],
    comments: [],
  };
}

describe("compare-releases", () => {
  it("says the candidate got worse and names what is new", async () => {
    const routes: Routes = {
      byVersion: { "2.5.0": riskyRelease(), "2.4.0": cleanRelease() },
    };

    const result = await answer(routes);
    const data = result.data as {
      comparison: { direction: string; scoreDelta: number; factors: { introduced: unknown[] } };
    };

    expect(result.ok).toBe(true);
    expect(data.comparison.direction).toBe("worse");
    expect(data.comparison.scoreDelta).toBeLessThan(0);
    expect(data.comparison.factors.introduced.length).toBeGreaterThan(0);
    expect(result.summary).toContain("point");
    expect(result.summary).toContain("lower");
  });

  it("reads both releases, not one twice", async () => {
    const seen: Array<{ source: string; variables: Record<string, unknown> }> = [];
    await answer({
      byVersion: { "2.5.0": riskyRelease(), "2.4.0": cleanRelease() },
      seen,
    });

    const versions = new Set(seen.map((call) => String(call.variables.versionName)));
    expect(versions).toEqual(new Set(["2.5.0", "2.4.0"]));
  });

  it("names what the baseline had and the candidate fixed", async () => {
    const result = await answer({
      byVersion: { "2.5.0": cleanRelease("2.5.0"), "2.4.0": riskyRelease("2.4.0") },
    });
    const data = result.data as {
      comparison: { direction: string; factors: { resolved: Array<{ title: string }> } };
    };

    expect(data.comparison.direction).toBe("better");
    expect(data.comparison.factors.resolved.length).toBeGreaterThan(0);
    expect(result.summary).toContain("higher");
  });

  it("refuses to compare a release with itself", async () => {
    const result = await compare(
      { ...payload, baselineVersionName: "2.5.0" },
      { client: createFakeClient(cleanRelease()) },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("cannot be compared with itself");
  });

  it("asks for the baseline instead of inventing one", async () => {
    const result = await compare(
      { projectKey: "SHIP", versionName: "2.5.0" },
      { client: createFakeClient(cleanRelease()) },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("baselineVersionName");
  });

  it("does not call a comparison empty when a release could not be read", async () => {
    const result = await answer({
      byVersion: { "2.5.0": cleanRelease("2.5.0"), "2.4.0": {} },
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("cannot compare");
    expect(result.summary).toContain("2.4.0");
  });

  it("merges coverage instead of reporting each source twice", async () => {
    const routes: Routes = {
      byVersion: {
        "2.5.0": { ...riskyRelease(), errors: { deployments: "Missing scope: read:graph:issue:jira" } },
        "2.4.0": cleanRelease("2.4.0"),
      },
    };

    const result = await answer(routes);
    const sources = result.coverage.map((entry) => entry.source);
    expect(new Set(sources).size).toBe(sources.length);
    expect(result.coverage.find((entry) => entry.source === "deployments")?.status).toBe(
      "not_permitted",
    );
    expect(result.summary).toContain("does not include deployments");
  });
});

describe("compare domain", () => {
  const factor = (id: string, penalty: number) => ({
    id,
    severity: "blocker" as const,
    title: id,
    detail: "",
    penalty,
  });

  const snapshot = (versionName: string, score: number, ids: string[]) => ({
    versionName,
    verdict: (score >= 85 ? "ship" : score >= 60 ? "ship_with_risk" : "do_not_ship") as
      | "ship"
      | "ship_with_risk"
      | "do_not_ship",
    score,
    riskFactors: ids.map((id) => factor(id, 10)),
  });

  it("classifies factors as resolved, introduced or persistent", () => {
    const comparison = compareReleases(snapshot("2.4.0", 80, ["a", "b"]), snapshot("2.5.0", 90, ["b", "c"]));
    expect(comparison.factors.resolved.map((f) => f.id)).toEqual(["a"]);
    expect(comparison.factors.introduced.map((f) => f.id)).toEqual(["c"]);
    expect(comparison.factors.persistent.map((f) => f.id)).toEqual(["b"]);
  });

  it("calls a level score unchanged when nothing moved", () => {
    const same = compareReleases(snapshot("2.4.0", 90, ["a"]), snapshot("2.5.0", 90, ["a"]));
    expect(same.direction).toBe("unchanged");
    expect(summariseComparison(same)).toContain("Scores are level at 90/100");
  });

  it("treats an unreadable release as unknown, not unchanged", () => {
    const unverified = compareReleases(
      { versionName: "2.4.0", verdict: "unverified", score: 0, riskFactors: [] },
      snapshot("2.5.0", 90, []),
    );
    expect(unverified.direction).toBe("unknown");
    expect(summariseComparison(unverified)).toContain("cannot compare");
  });
});

describe("mergeCoverage", () => {
  it("keeps one entry per source and lets the worst side win", () => {
    const merged = mergeCoverage([
      { label: "2.5.0", entries: [{ source: "workItems", status: "read" }] },
      { label: "2.4.0", entries: [{ source: "workItems", status: "unavailable" }] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("unavailable");
  });

  it("does not let an empty side hide a readable one", () => {
    const merged = mergeCoverage([
      { label: "2.5.0", entries: [{ source: "workItems", status: "empty" }] },
      { label: "2.4.0", entries: [{ source: "workItems", status: "read" }] },
    ]);
    expect(merged[0]?.status).toBe("read");
  });
});
