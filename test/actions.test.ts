import { describe, expect, it } from "vitest";

import { run as readiness } from "../src/actions/get-release-readiness";
import { run as blockers } from "../src/actions/list-open-blockers";
import { run as explain } from "../src/actions/explain-blocker";
import { run as notes } from "../src/actions/draft-release-notes";
import { createFakeClient, healthyRoutes, type Routes } from "./helpers/fake-client";
import type { ToolResult } from "../src/tools/result";

const payload = { projectKey: "SHIP", versionName: "2.4.0", context: { cloudId: "cloud-1" } };

function answer(routes: Routes): Promise<ToolResult> {
  return readiness(payload, { client: createFakeClient(routes) });
}

describe("get-release-readiness", () => {
  it("answers a healthy release in one sentence", async () => {
    const result = await answer(healthyRoutes());
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("looks safe to ship");
    expect(result.summary).toContain("Score 100/100");
    expect(result.warnings).toEqual([]);
    expect((result.data as { verdict: string }).verdict).toBe("ship");
  });

  it("says not ready when an open pull request contradicts a done work item", async () => {
    const routes = healthyRoutes();
    routes.pullRequests = [
      { id: "pr-1", title: "Readiness endpoint", state: "open", workItemKey: "SHIP-1" },
    ];

    const result = await answer(routes);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("is not ready to ship");
    expect((result.data as { verdict: string }).verdict).toBe("do_not_ship");
  });

  it("refuses to claim a release is fine when it read nothing", async () => {
    const result = await answer({});
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("unknown, not clear");
  });

  it("reports a missing scope as unknown and appends the caveat", async () => {
    const routes = healthyRoutes();
    routes.errors = { workItems: "Missing scope: read:graph:issue:jira" };

    const result = await answer(routes);
    expect(result.ok).toBe(false);
    expect(result.coverage.find((c) => c.source === "workItems")?.status).toBe("not_permitted");
    expect(result.summary).toContain("does not include work items");
  });

  it("degrades to unavailable when a source throws", async () => {
    const routes = healthyRoutes();
    routes.throws = { deployments: new Error("connection reset") };

    const result = await answer(routes);
    expect(result.coverage.find((c) => c.source === "deployments")?.status).toBe("unavailable");
    expect(result.summary).toContain("deployments (query failed)");
  });

  it("ignores work items that belong to another version", async () => {
    const routes = healthyRoutes();
    routes.workItems = [
      {
        key: "SHIP-7",
        summary: "Next release work",
        status: { name: "Done" },
        fixVersions: [{ name: "2.5.0" }],
      },
    ];

    const result = await answer(routes);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("no work items in scope");
  });

  it("asks for missing inputs instead of guessing them", async () => {
    const result = await readiness(
      { context: { jira: { projectKey: "SHIP" } } },
      { client: createFakeClient(healthyRoutes()) },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("I need projectKey and versionName");
    expect(result.summary).toContain("project SHIP");
  });

  it("asks for exactly the one input that is missing", async () => {
    const result = await readiness(
      { projectKey: "SHIP" },
      { client: createFakeClient(healthyRoutes()) },
    );
    expect(result.summary).toContain("I need versionName");
    expect(result.summary).not.toContain("projectKey and");
  });
});

function blockedRoutes(): Routes {
  const routes = healthyRoutes();
  routes.workItems = [
    {
      key: "SHIP-442",
      summary: "Migrate billing tables",
      issueType: { name: "Task" },
      status: { name: "In Progress" },
      blockedReason: "Waiting on legal sign-off",
      url: "https://example.atlassian.net/browse/SHIP-442",
      fixVersions: [{ name: "2.4.0" }],
    },
  ];
  routes.pullRequests = [
    { id: "pr-9", title: "Billing migration", state: "open", workItemKey: "SHIP-442" },
  ];
  return routes;
}

describe("explain-blocker", () => {
  it("explains one blocker with its work item and link", async () => {
    const result = await explain(
      { ...payload, workItemKey: "SHIP-442" },
      { client: createFakeClient(blockedRoutes()) },
    );
    const data = result.data as { blocker: { id: string }; workItem: { key: string } };

    expect(result.ok).toBe(true);
    expect(data.blocker.id).toBe("blocked-work-item:SHIP-442");
    expect(data.workItem.key).toBe("SHIP-442");
    expect(result.summary).toContain("Waiting on legal sign-off");
    expect(result.summary).toContain("https://example.atlassian.net/browse/SHIP-442");
  });

  it("includes the evidence, not just the reason", async () => {
    const result = await explain(
      { ...payload, workItemKey: "SHIP-442" },
      { client: createFakeClient(blockedRoutes()) },
    );
    const data = result.data as { pullRequests: Array<{ id: string }> };
    expect(data.pullRequests.map((pr) => pr.id)).toEqual(["pr-9"]);
  });

  it("lists what it does know when the key is wrong", async () => {
    const result = await explain(
      { ...payload, workItemKey: "SHIP-999" },
      { client: createFakeClient(blockedRoutes()) },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("could not find that blocker");
    expect(result.summary).toContain("blocked-work-item:SHIP-442");
  });

  it("does not pretend there is a blocker when there is none", async () => {
    const result = await explain(payload, { client: createFakeClient(healthyRoutes()) });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("no blockers at all");
  });
});

describe("draft-release-notes", () => {
  it("groups completed work and excludes nothing when all is done", async () => {
    const result = await notes(payload, { client: createFakeClient(healthyRoutes()) });
    const data = result.data as { markdown: string; excludedCount: number };

    expect(result.ok).toBe(true);
    expect(data.markdown).toContain("## 2.4.0");
    expect(data.markdown).toContain("### Story");
    expect(data.markdown).toContain("- Add readiness endpoint (SHIP-1)");
    expect(data.excludedCount).toBe(0);
  });

  it("leaves unfinished and blocked items out of the notes", async () => {
    const routes = healthyRoutes();
    routes.workItems = [
      ...(routes.workItems as unknown[]),
      {
        key: "SHIP-3",
        summary: "Unfinished work",
        status: { name: "In Progress" },
        fixVersions: [{ name: "2.4.0" }],
      },
    ];

    const result = await notes(payload, { client: createFakeClient(routes) });
    const data = result.data as { markdown: string; excludedCount: number };

    expect(data.excludedCount).toBe(1);
    expect(data.markdown).not.toContain("Unfinished work");
    expect(result.summary).toContain("1 unfinished or blocked item(s) were left out");
  });

  it("refuses to draft notes for a release with nothing completed", async () => {
    const routes = healthyRoutes();
    routes.workItems = [
      {
        key: "SHIP-3",
        summary: "Unfinished work",
        status: { name: "In Progress" },
        fixVersions: [{ name: "2.4.0" }],
      },
    ];

    const result = await notes(payload, { client: createFakeClient(routes) });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("nothing to put in release notes");
  });
});

describe("scope probe", () => {
  it("confirms a genuinely empty release when the user can read their own work", async () => {
    const result = await answer({ probe: [{ key: "OTHER-1" }] });

    expect(result.coverage.find((c) => c.source === "workItems")?.status).toBe("empty");
    expect(result.summary).toContain("no work items in scope");
    // An empty answer is a real answer, so no caveat is appended.
    expect(result.summary).not.toContain("does not include");
  });

  it("turns a denied probe into a coverage caveat instead of a false all-clear", async () => {
    const result = await answer({ errors: { probe: "Missing scope: read:graph:issue:jira" } });

    expect(result.coverage.find((c) => c.source === "workItems")?.status).toBe("not_permitted");
    expect(result.summary).toContain("does not include work items");
  });
});

describe("list-open-blockers", () => {
  it("returns only blockers, not warnings", async () => {
    const routes = healthyRoutes();
    routes.workItems = [
      {
        key: "SHIP-1",
        summary: "Blocked work",
        status: { name: "In Progress" },
        fixVersions: [{ name: "2.4.0" }],
      },
    ];
    routes.comments = [{ workItemKey: "SHIP-1", body: "Can this be split?" }];

    const result = await blockers(payload, { client: createFakeClient(routes) });
    const data = result.data as { blockers: Array<{ severity: string }> };
    expect(data.blockers.length).toBeGreaterThan(0);
    expect(data.blockers.every((factor) => factor.severity === "blocker")).toBe(true);
    expect(result.summary).toMatch(/blocker(s)? holding back SHIP 2\.4\.0/);
  });

  it("says so plainly when there are none", async () => {
    const result = await blockers(payload, { client: createFakeClient(healthyRoutes()) });
    expect(result.summary).toBe("No blockers found for SHIP 2.4.0.");
  });
});
