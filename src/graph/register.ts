import api, { route, type APIResponse, type RequestInit, type Route } from "@forge/api";

import { PERSISTED_RELEASE_SCOPE, PERSISTED_RELEASE_SCOPE_PARAMS } from "./queries";

/**
 * Registers the release-scope Cypher query and returns its key.
 *
 * Query registration is a setup-time operation, and Atlassian documents submitting
 * it "from a setup script on every deploy" as safe: identical text is deduplicated
 * and returns the original key. That is what makes self-registration reasonable here
 * — it needs no stored state, and a cold start that repeats it costs one cheap call.
 *
 * The identity matters. A personal API token is rejected by this gateway (`401`), and
 * only a contributor on the owning app may register. Forge's product fetch carries a
 * real user identity, so it is tried first, then the app's own identity, which owns
 * the query it is registering.
 */

/**
 * Must match `app.id` in manifest.yml. A test fails if the two drift, because
 * registering under the wrong id would succeed against an app that can never
 * execute the query it just stored.
 */
export const APP_ARI = "ari:cloud:ecosystem::app/a511fd32-b70e-4242-a838-74b273f77a43";

export const REGISTRATION_PATH = "/gateway/api/twg/cypher-queries";

type AtlassianRequest = (url: Route, init: RequestInit) => Promise<APIResponse>;

function requestBody(): string {
  return JSON.stringify({
    appId: APP_ARI,
    name: "release-scope",
    cypher: PERSISTED_RELEASE_SCOPE,
    paramsSchema: PERSISTED_RELEASE_SCOPE_PARAMS.map((param) => ({ ...param })),
  });
}

async function submit(request: AtlassianRequest): Promise<string | undefined> {
  const response = await request(route`${REGISTRATION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Gateway POSTs are rejected without this, and it is inert where it is not needed.
      "X-Atlassian-Token": "no-check",
    },
    body: requestBody(),
  });

  // 200 means the same text was already registered; either way the key is the answer.
  if (response.status !== 200 && response.status !== 201) return undefined;

  const parsed = (await response.json()) as unknown;
  if (!parsed || typeof parsed !== "object") return undefined;

  const key = (parsed as Record<string, unknown>).queryKey;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/** Returns the key, or undefined if this app cannot register its query on this site. */
export async function registerReleaseScopeQuery(): Promise<string | undefined> {
  try {
    const asUser = await submit((url, init) => api.asUser().requestAtlassian(url, init));
    if (asUser) return asUser;
  } catch {
    // A user who is not a contributor cannot register. The app that owns the query
    // may still be able to, so try that identity next.
  }

  try {
    return await submit((url, init) => api.asApp().requestAtlassian(url, init));
  } catch {
    return undefined;
  }
}
