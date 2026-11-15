/**
 * Coverage.
 *
 * The Teamwork Graph returns empty results when a scope is missing instead of
 * raising an error. A release app that reads that as "no blockers" says the
 * opposite of the truth, so every source is tracked explicitly and every tool
 * result carries the coverage list back to the agent.
 */

export type SourceId = "workItems" | "pullRequests" | "deployments" | "reviewSignals";

/**
 * - `read`          data came back and was used
 * - `empty`         the query succeeded and returned nothing
 * - `not_permitted` the user lacks the scope, so emptiness proves nothing
 * - `unavailable`   the query failed for another reason
 */
export type CoverageStatus = "read" | "empty" | "not_permitted" | "unavailable";

export interface CoverageEntry {
  source: SourceId;
  status: CoverageStatus;
  detail?: string;
}

export const ALL_SOURCES: SourceId[] = [
  "workItems",
  "pullRequests",
  "deployments",
  "reviewSignals",
];

export const SOURCE_LABELS: Record<SourceId, string> = {
  workItems: "work items",
  pullRequests: "linked pull requests",
  deployments: "deployments",
  reviewSignals: "review comments",
};

export function entry(
  source: SourceId,
  status: CoverageStatus,
  detail?: string,
): CoverageEntry {
  return detail === undefined ? { source, status } : { source, status, detail };
}

/** True only when no source is silently missing. `empty` is a real answer. */
export function isComplete(entries: CoverageEntry[]): boolean {
  return entries.every((e) => e.status === "read" || e.status === "empty");
}

/** The sentence a tool appends when it could not see everything it wanted. */
export function caveat(entries: CoverageEntry[]): string | undefined {
  const missing = entries.filter((e) => e.status === "not_permitted" || e.status === "unavailable");
  if (missing.length === 0) return undefined;

  const parts = missing.map((e) => {
    const label = SOURCE_LABELS[e.source];
    return e.status === "not_permitted"
      ? `${label} (not permitted for this user)`
      : `${label} (query failed)`;
  });

  return `This view does not include ${parts.join(", ")}. Treat those areas as unknown, not as clear.`;
}

/**
 * Coverage for a request that reads two releases at once.
 *
 * Sources are merged rather than concatenated, because the caveat sentence names
 * each source once: two `pullRequests` entries would otherwise be reported twice
 * and read as two separate problems. A source is only as good as its worst side,
 * and a readable side beats an empty one.
 */
export function mergeCoverage(
  sides: Array<{ label: string; entries: CoverageEntry[] }>,
): CoverageEntry[] {
  const merged = new Map<SourceId, { status: CoverageStatus; details: string[] }>();

  for (const side of sides) {
    for (const item of side.entries) {
      const detail = item.detail === undefined ? undefined : `${side.label}: ${item.detail}`;
      const current = merged.get(item.source);

      if (current === undefined) {
        merged.set(item.source, {
          status: item.status,
          details: detail === undefined ? [] : [detail],
        });
        continue;
      }

      current.status = worseStatus(current.status, item.status);
      if (detail !== undefined) current.details.push(detail);
    }
  }

  return ALL_SOURCES.filter((source) => merged.has(source)).map((source) => {
    const value = merged.get(source);
    return entry(
      source,
      value?.status ?? "unavailable",
      value !== undefined && value.details.length > 0 ? value.details.join(" | ") : undefined,
    );
  });
}

/** Higher wins. A failure on either side taints the source; readability survives. */
const STATUS_RANK: Record<CoverageStatus, number> = {
  empty: 0,
  read: 1,
  unavailable: 2,
  not_permitted: 3,
};

function worseStatus(a: CoverageStatus, b: CoverageStatus): CoverageStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * A missing scope and an empty project look identical in the response. The only
 * honest way to tell them apart is to probe with a query whose answer should not
 * be empty for a real user, e.g. "work items assigned to me".
 */
export function interpretProbe(result: {
  count: number;
  errors: { message: string }[];
}): CoverageStatus {
  if (result.errors.length > 0) {
    return isPermissionMessage(result.errors.map((e) => e.message).join(" "))
      ? "not_permitted"
      : "unavailable";
  }
  return result.count > 0 ? "read" : "empty";
}

const PERMISSION_HINTS = [
  "scope",
  "permission",
  "forbidden",
  "unauthorized",
  "not allowed",
  "not authorised",
  "not authorized",
];

export function isPermissionMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return PERMISSION_HINTS.some((hint) => lower.includes(hint));
}
