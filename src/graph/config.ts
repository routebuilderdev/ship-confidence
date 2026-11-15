/**
 * Runtime configuration.
 *
 * The Teamwork Graph needs a persisted-query key to answer "which work items belong
 * to this version". The key is produced once, at registration time, and stored as an
 * environment variable so it can be rotated without a code change:
 *
 *   forge variables set -e production SHIP_CONFIDENCE_TWG_QUERY_KEY <queryKey>
 *
 * Absent a key the app still runs; it reports that release scope is unreadable
 * instead of pretending the release is clean.
 */
export function persistedQueryKey(): string | undefined {
  const value = process.env.SHIP_CONFIDENCE_TWG_QUERY_KEY;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
