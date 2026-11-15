import type { TeamworkGraphClient } from "./client";
import { withTimeout } from "./client";
import type { CoverageEntry, CoverageStatus } from "./coverage";
import { entry, interpretProbe } from "./coverage";
import { edgesOf } from "./edges";
import { QUERIES } from "./queries";

/**
 * Access probe.
 *
 * The Teamwork Graph answers a missing scope with an empty result, not an error,
 * so "no work items" and "I may not read work items" look identical in the main
 * query. The only way to tell them apart is to ask a question that a real user
 * cannot answer with nothing: "list work items assigned to me".
 *
 * This runs only when the main answer came back empty, so the happy path costs
 * nothing.
 */
export interface ProbeResult {
  status: CoverageStatus;
  detail?: string;
}

export async function probeAccess(client: TeamworkGraphClient): Promise<ProbeResult> {
  try {
    const result = await withTimeout(client.request<unknown>(QUERIES.probe, {}), "probe");
    const status = interpretProbe({
      count: edgesOf(result.data).length,
      errors: result.errors,
    });

    const detail = result.errors[0]?.message;
    return detail === undefined ? { status } : { status, detail };
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error ? error.message : "probe failed" };
  }
}

/**
 * Interpret an empty work-item result.
 *
 * - probe can read the user's own work  → the release genuinely has no items
 * - probe is denied or fails            → the emptiness proves nothing
 */
export async function resolveEmptyWorkItems(
  client: TeamworkGraphClient,
  original: CoverageEntry,
): Promise<CoverageEntry> {
  const probe = await probeAccess(client);

  if (probe.status === "read" || probe.status === "empty") {
    return entry(
      "workItems",
      "empty",
      "The user's own assigned work items were readable, so this release really has no items in scope.",
    );
  }

  return entry(
    "workItems",
    probe.status,
    probe.detail ??
      "No work items were returned and the access probe could not confirm read access, so emptiness is not evidence of safety.",
  );
}
