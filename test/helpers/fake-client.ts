import type { GraphResult, TeamworkGraphClient } from "../../src/graph/client";

/**
 * A fake graph client. Routes on the curated query being called, which is the
 * seam the tests care about: everything below it is pure mapping.
 */
export interface Routes {
  workItems?: unknown[];
  pullRequests?: unknown[];
  deployments?: unknown[];
  comments?: unknown[];
  /** Response to the access probe, which only runs when work items come back empty. */
  probe?: unknown[];
  /** Per-source failure injection, e.g. { workItems: "missing scope" }. */
  errors?: Partial<Record<keyof Routes, string>>;
  /** Per-source throw injection, to exercise the timeout/error path. */
  throws?: Partial<Record<keyof Routes, Error>>;
  /** Capture variables for assertions about page size. */
  seen?: Array<{ source: string; variables: Record<string, unknown> }>;
  /**
   * Per-version responses, keyed by the `versionName` variable. Used by the
   * comparison tests, which read two releases through the same client.
   */
  byVersion?: Record<string, Routes>;
}

function connection(nodes: unknown[]): unknown {
  return { edges: nodes.map((node) => ({ node })) };
}

function routeOf(document: string): keyof Routes | undefined {
  if (document.includes("atlassianUserAssignedJiraWorkItems")) return "probe";
  if (document.includes("linkedExternalPullRequests")) return "pullRequests";
  if (document.includes("linkedExternalDeployments")) return "deployments";
  if (document.includes("jiraWorkItemComments")) return "comments";
  if (document.includes("jiraSpaceWorkItems")) return "workItems";
  return undefined;
}

export function createFakeClient(routes: Routes = {}): TeamworkGraphClient {
  return {
    async request<T>(
      document: string,
      variables: Record<string, unknown>,
    ): Promise<GraphResult<T>> {
      const source = routeOf(document);
      if (!source) {
        return { errors: [{ message: "unrouted query in test" }] };
      }

      routes.seen?.push({ source, variables });

      const versionName = variables.versionName;
      const active =
        (typeof versionName === "string" ? routes.byVersion?.[versionName] : undefined) ?? routes;

      const thrown = active.throws?.[source];
      if (thrown) throw thrown;

      const message = active.errors?.[source];
      if (message) return { errors: [{ message }] };

      const nodes = active[source];
      return {
        data: { connection: connection(Array.isArray(nodes) ? nodes : []) } as T,
        errors: [],
      };
    },
  };
}

/** A complete, healthy release: useful as the baseline a test then breaks. */
export function healthyRoutes(): Routes {
  return {
    workItems: [
      {
        key: "SHIP-1",
        summary: "Add readiness endpoint",
        issueType: { name: "Story" },
        status: { name: "Done", category: "done" },
        fixVersions: [{ name: "2.4.0" }],
      },
      {
        key: "SHIP-2",
        summary: "Tune confidence thresholds",
        issueType: { name: "Task" },
        status: { name: "Done", category: "done" },
        fixVersions: [{ name: "2.4.0" }],
      },
    ],
    pullRequests: [
      {
        id: "pr-1",
        title: "Readiness endpoint",
        state: "merged",
        reviewDecision: "approved",
        workItemKey: "SHIP-1",
      },
    ],
    deployments: [
      { id: "dep-1", environment: "staging", status: "successful", workItemKey: "SHIP-1" },
    ],
    comments: [],
  };
}
