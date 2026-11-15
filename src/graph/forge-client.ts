import api, { route } from "@forge/api";

import type { GraphResult, ReleaseScopeResult, TeamworkGraphClient } from "./client";
import { issueAri } from "./queries";

/**
 * Forge adapter.
 *
 * `asUser()` is the only documented Teamwork Graph entry point in Forge;
 * `asApp()` has no typed support (open upstream thread, Oct 2026). That is a
 * feature for this app: every answer is filtered by the asking user's own
 * permissions, so the tool can never leak a work item the user cannot open.
 *
 * `@forge/api` types this method as returning a fetch `Response`, while the docs
 * show a plain JSON body. Both are accepted here: a `Response` is unwrapped with
 * `.json()`, anything else is treated as already-parsed GraphQL data. That keeps
 * a platform typing change from turning into a production incident.
 */
export function createForgeGraphClient(): TeamworkGraphClient {
  return {
    async request<T>(
      document: string,
      variables: Record<string, unknown>,
    ): Promise<GraphResult<T>> {
      const raw = (await api.asUser().requestTeamworkGraph(document, variables)) as unknown;

      return normalise(await unwrap(raw));
    },

    async searchRelease(
      projectKey: string,
      versionName: string,
      cloudId: string | undefined,
    ): Promise<ReleaseScopeResult> {
      const jql = `project = "${escapeJql(projectKey)}" AND fixVersion = "${escapeJql(versionName)}" ORDER BY updated DESC`;

      try {
        const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            jql,
            maxResults: 25,
            fields: ["summary", "status", "issuetype", "resolutiondate"],
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            nodes: [],
            error: { message: `Jira search returned ${response.status}: ${body.slice(0, 160)}` },
            notPermitted: response.status === 401 || response.status === 403,
          };
        }

        const body = (await response.json()) as { issues?: unknown };
        return { nodes: (Array.isArray(body.issues) ? body.issues : []).map((issue) => toNode(issue, cloudId)) };
      } catch (error) {
        return {
          nodes: [],
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  };
}

/** JQL strings are quoted, so a quote in a name would end the value early. */
function escapeJql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Present a Jira issue the way the graph presents a work item, so one mapper serves
 * both sources. The ARI is what the per-item graph queries take as their id.
 */
function toNode(issue: unknown, cloudId: string | undefined): Record<string, unknown> {
  const record = issue && typeof issue === "object" ? (issue as Record<string, unknown>) : {};
  const fields = record.fields && typeof record.fields === "object"
    ? (record.fields as Record<string, unknown>)
    : {};
  const id = record.id === undefined || record.id === null ? undefined : String(record.id);

  return {
    ...(id !== undefined && cloudId !== undefined ? { id: issueAri(cloudId, id) } : {}),
    key: record.key,
    summary: fields.summary,
    issueType: fields.issuetype,
    status: fields.status,
    resolvedAt: fields.resolutiondate,
  };
}

async function unwrap(value: unknown): Promise<unknown> {
  if (
    value &&
    typeof value === "object" &&
    "json" in value &&
    typeof (value as { json?: unknown }).json === "function"
  ) {
    try {
      return await (value as { json: () => Promise<unknown> }).json();
    } catch {
      return { errors: [{ message: "Could not parse Teamwork Graph response body" }] };
    }
  }
  return value;
}

function normalise<T>(response: unknown): GraphResult<T> {
  if (response === null || typeof response !== "object") {
    return { errors: [{ message: "Teamwork Graph returned a non-object response" }] };
  }

  const record = response as Record<string, unknown>;
  const rawErrors = Array.isArray(record.errors) ? record.errors : [];

  const errors = rawErrors.map((error) => {
    if (typeof error === "string") return { message: error };
    if (error && typeof error === "object" && "message" in error) {
      return { message: String((error as { message: unknown }).message) };
    }
    return { message: "Unknown Teamwork Graph error" };
  });

  // Accept both `{ data }` envelopes and a direct payload.
  const data = "data" in record ? (record.data as T | undefined) : (response as T);

  if (errors.length > 0 && data === undefined) {
    return { errors };
  }

  return data === undefined ? { errors } : { data, errors };
}
