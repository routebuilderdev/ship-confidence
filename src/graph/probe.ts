import type { TeamworkGraphClient } from "./client";
import { withTimeout } from "./client";
import type { CoverageStatus } from "./coverage";
import { interpretProbe } from "./coverage";
import { edgesOf } from "./edges";
import { QUERIES, userAri } from "./queries";

/**
 * Access probe.
 *
 * The Teamwork Graph answers a missing scope with an empty result, not an error,
 * so "no work items in this release" and "I may not read work items" look identical.
 * The only way to tell them apart is to ask a question a real user cannot answer
 * with nothing: "list work items assigned to me".
 *
 * This runs only when the release came back empty, so the happy path costs nothing.
 */
export interface ProbeResult {
  status: CoverageStatus;
  detail?: string;
}

export async function probeAccess(
  client: TeamworkGraphClient,
  accountId: string,
): Promise<ProbeResult> {
  try {
    const result = await withTimeout(
      client.request<unknown>(QUERIES.probe, { userId: userAri(accountId), first: 1 }),
      "probe",
    );

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
