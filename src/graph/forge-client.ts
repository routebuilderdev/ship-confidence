import api from "@forge/api";

import type { GraphResult, TeamworkGraphClient } from "./client";

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
