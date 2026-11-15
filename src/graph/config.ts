import { registerReleaseScopeQuery } from "./register";

/**
 * Runtime configuration.
 *
 * The Teamwork Graph needs a persisted-query key to answer "which work items belong
 * to this version". The key can be supplied ahead of time and rotated without a code
 * change:
 *
 *   forge variables set -e production SHIP_CONFIDENCE_TWG_QUERY_KEY <queryKey>
 *
 * When it is not supplied, the app registers its own query and caches the key for the
 * lifetime of the container. Registration is idempotent, so a cold start repeating it
 * is harmless.
 *
 * Absent a key the app still runs; it reports that release scope is unreadable
 * instead of pretending the release is clean.
 */
export function persistedQueryKey(): string | undefined {
  const value = process.env.SHIP_CONFIDENCE_TWG_QUERY_KEY;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

let cached: string | undefined;

/** The configured key, or one this app registered for itself. */
export async function resolveQueryKey(): Promise<string | undefined> {
  const configured = persistedQueryKey();
  if (configured) return configured;

  if (cached === undefined) {
    cached = await registerReleaseScopeQuery();
  }
  return cached;
}
