import type { WorkItem } from "../domain/types";
import { buildResult, type ToolResult } from "../tools/result";
import { answerReleaseQuestion, defaultDeps, type Deps } from "../tools/release-runner";

/**
 * `draft-release-notes` — the payoff tool.
 *
 * The other tools help someone decide; this one produces the artifact they were
 * going to write by hand. It deliberately only uses completed work items and
 * skips anything still blocked, so the notes never claim shipped work that was
 * not shipped.
 */
export async function run(payload: unknown, deps: Deps = defaultDeps()): Promise<ToolResult> {
  return answerReleaseQuestion(payload, deps, (loaded, request) => {
    const completed = loaded.context.workItems.filter(
      (item) => item.status === "done" && !item.blockedReason,
    );
    const excluded = loaded.context.workItems.length - completed.length;

    if (completed.length === 0) {
      return buildResult({
        ok: false,
        summary: `There are no completed work items in ${request.projectKey} ${request.versionName}, so there is nothing to put in release notes yet.`,
        coverage: loaded.coverage,
        warnings: loaded.warnings,
      });
    }

    const notes = renderNotes(completed, request.versionName);
    const excludedNote =
      excluded > 0 ? ` ${excluded} unfinished or blocked item(s) were left out.` : "";

    return buildResult({
      ok: true,
      summary: `Drafted release notes for ${completed.length} completed work item${completed.length === 1 ? "" : "s"} in ${request.projectKey} ${request.versionName}.${excludedNote}`,
      coverage: loaded.coverage,
      warnings: loaded.warnings,
      data: {
        markdown: notes,
        includedKeys: completed.map((item) => item.key),
        excludedCount: excluded,
      },
    });
  });
}

/** Grouped by issue type so the output looks like notes a human would write. */
function renderNotes(items: WorkItem[], versionName: string): string {
  const groups = new Map<string, WorkItem[]>();
  for (const item of items) {
    const group = groups.get(item.issueType) ?? [];
    group.push(item);
    groups.set(item.issueType, group);
  }

  const lines = [`## ${versionName}`, ""];
  for (const [issueType, group] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(`### ${issueType}`);
    for (const item of group) {
      lines.push(`- ${item.summary} (${item.key})`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export const handler = (payload: unknown): Promise<ToolResult> => run(payload);
