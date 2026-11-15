import type { GraphResult, TeamworkGraphClient } from "../../src/graph/client";

/**
 * A fake graph client. Routes on the document being called, which is the seam the
 * tests care about: everything below it is pure mapping.
 *
 * Two shapes matter. Release scope comes back as a Cypher connection
 * (`customQuery.edges[].node.columns[].value.data`), because version → work item is
 * only reachable through a persisted query. Per-item detail comes back as ordinary
 * typed connections with union members distinguished by `__typename`.
 */
export interface Routes {
  /** `JiraWorkItem` payloads, wrapped into the Cypher result shape by the fake. */
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
  /** Capture variables for assertions about parameters and page size. */
  seen?: Array<{ source: string; variables: Record<string, unknown> }>;
  /**
   * Per-version responses, keyed by the `versionName` parameter. Used by the
   * comparison tests, which read two releases through the same client.
   */
  byVersion?: Record<string, Routes>;
}

function connection(nodes: unknown[]): unknown {
  return { edges: nodes.map((node) => ({ node })) };
}

/** Wrap work-item payloads the way `customQuery` returns them. */
function cypherConnection(nodes: unknown[]): unknown {
  return {
    edges: nodes.map((node, index) => ({
      node: {
        columns: [
          {
            key: "item",
            value: {
              __typename: "CypherQueryResultNode",
              id: `graph-${index}`,
              // A work item needs a graph id for the per-item follow-up queries, and
              // fixtures should not have to invent ARIs.
              data: {
                __typename: "JiraWorkItem",
                id: `ari:cloud:jira::issue/${index}`,
                ...(node as object),
              },
            },
          },
        ],
      },
    })),
    pageInfo: { hasNextPage: false, endCursor: null },
  };
}

function routeOf(document: string): keyof Routes | undefined {
  if (document.includes("atlassianUserAssignedJiraWorkItems")) return "probe";
  if (document.includes("jiraWorkItemDevelopmentArtifacts")) return "pullRequests";
  if (document.includes("jiraWorkItemComments")) return "comments";
  if (document.includes("customQuery")) return "workItems";
  return undefined;
}

/**
 * Release scope is aimed with a version ARI, mirroring the real graph. The ids come
 * from the `@forge/api` stub in `test/setup.ts`.
 */
const VERSION_BY_ARI: Record<string, string> = {
  "ari:cloud:jira:cloud-1:version/10000": "2.4.0",
  "ari:cloud:jira:cloud-1:version/10001": "2.5.0",
};

function versionOf(source: keyof Routes, variables: Record<string, unknown>): unknown {
  if (source === "workItems") {
    const params = variables.queryParams;
    const ari =
      typeof params === "object" && params !== null
        ? (params as Record<string, unknown>).versionAri
        : undefined;
    return typeof ari === "string" ? VERSION_BY_ARI[ari] : undefined;
  }
  return variables.versionName;
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

      const versionName = versionOf(source, variables);
      const active =
        (typeof versionName === "string" ? routes.byVersion?.[versionName] : undefined) ?? routes;

      const thrown = active.throws?.[source];
      if (thrown) throw thrown;

      const message = active.errors?.[source];
      if (message) return { errors: [{ message }] };

      // Deployment detail arrives through the artefacts query, so the fake splits
      // the two arrays back out by type to keep test setup declarative.
      if (source === "pullRequests") {
        const pulls = (active.pullRequests ?? []).map((node) => ({
          __typename: "ExternalPullRequest",
          ...(node as object),
        }));
        const deployments = (active.deployments ?? []).map((node) => ({
          __typename: "ExternalDeployment",
          ...(node as object),
        }));
        return { data: { connection: connection([...pulls, ...deployments]) } as T, errors: [] };
      }

      const nodes = active[source];
      const list = Array.isArray(nodes) ? nodes : [];

      if (source === "workItems") {
        return { data: { customQuery: cypherConnection(list) } as T, errors: [] };
      }

      return { data: { connection: connection(list) } as T, errors: [] };
    },
  };
}

/** A complete, healthy release: useful as the baseline a test then breaks. */
export function healthyRoutes(): Routes {
  return {
    workItems: [
      {
        id: "ari:cloud:jira::issue/1",
        key: "SHIP-1",
        summary: "Add readiness endpoint",
        issueType: { name: "Story" },
        status: { name: "Done", statusCategory: { key: "done" } },
      },
      {
        id: "ari:cloud:jira::issue/2",
        key: "SHIP-2",
        summary: "Tune confidence thresholds",
        issueType: { name: "Task" },
        status: { name: "Done", statusCategory: { key: "done" } },
      },
    ],
    pullRequests: [{ id: "pr-1", title: "Readiness endpoint", status: "MERGED", reviewers: [] }],
    deployments: [
      { id: "dep-1", state: "SUCCESSFUL", environment: { displayName: "staging", type: "STAGING" } },
    ],
    comments: [],
  };
}
