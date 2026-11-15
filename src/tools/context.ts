/**
 * Payload handling for `rovo:action` handlers.
 *
 * Inputs are produced by an LLM reading a chat message, so they are untrusted in
 * a specific way: they may be wrong, missing, or invented. They are never used
 * for authorization. The caller's identity comes from `context`, which Forge
 * sets, never from the model.
 */

export interface ActionContext {
  cloudId?: string;
  /** Identity of the person who asked. The only source of authorization. */
  accountId?: string;
  moduleKey?: string;
  jira?: {
    issueKey?: string;
    projectKey?: string;
    issueId?: string;
    issueType?: string;
    url?: string;
  };
  confluence?: {
    contentId?: string;
    spaceKey?: string;
    spaceId?: string;
  };
}

export interface ReleaseRequest {
  projectKey: string;
  versionName: string;
  context: ActionContext;
}

export type ParsedRequest =
  | { kind: "ok"; request: ReleaseRequest }
  | { kind: "missing"; summary: string; missing: string[]; context: ActionContext };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Reads one optional string input without trusting its type. */
export function readInput(payload: unknown, name: string): string | undefined {
  return asString(asRecord(payload)[name]);
}

export function readContext(payload: unknown): ActionContext {
  const raw = asRecord(asRecord(payload).context);

  const jira = asRecord(raw.jira);
  const confluence = asRecord(raw.confluence);

  return {
    ...(asString(raw.cloudId) ? { cloudId: asString(raw.cloudId) } : {}),
    ...(asString(raw.accountId) ? { accountId: asString(raw.accountId) } : {}),
    ...(asString(raw.moduleKey) ? { moduleKey: asString(raw.moduleKey) } : {}),
    ...(Object.keys(jira).length > 0
      ? {
          jira: {
            ...(asString(jira.issueKey) ? { issueKey: asString(jira.issueKey) } : {}),
            ...(asString(jira.projectKey) ? { projectKey: asString(jira.projectKey) } : {}),
            ...(asString(jira.issueId) ? { issueId: asString(jira.issueId) } : {}),
            ...(asString(jira.issueType) ? { issueType: asString(jira.issueType) } : {}),
            ...(asString(jira.url) ? { url: asString(jira.url) } : {}),
          },
        }
      : {}),
    ...(Object.keys(confluence).length > 0
      ? {
          confluence: {
            ...(asString(confluence.contentId) ? { contentId: asString(confluence.contentId) } : {}),
            ...(asString(confluence.spaceKey) ? { spaceKey: asString(confluence.spaceKey) } : {}),
            ...(asString(confluence.spaceId) ? { spaceId: asString(confluence.spaceId) } : {}),
          },
        }
      : {}),
  };
}

/**
 * A missing input is answered, not thrown. The agent reads the summary, asks the
 * user for the missing value, and calls again — the closest a `rovo:action` can
 * get to a multi-round tool result.
 */
export function parseReleaseRequest(payload: unknown): ParsedRequest {
  const record = asRecord(payload);
  const context = readContext(payload);

  const projectKey = asString(record.projectKey);
  const versionName = asString(record.versionName);

  const missing: string[] = [];
  if (!projectKey) missing.push("projectKey");
  if (!versionName) missing.push("versionName");

  if (projectKey && versionName) {
    return { kind: "ok", request: { projectKey, versionName, context } };
  }

  const hints: string[] = [];
  if (!projectKey && context.jira?.projectKey) {
    hints.push(`The current context is project ${context.jira.projectKey}.`);
  }
  if (!versionName) {
    hints.push("Ask the user which release version they mean, for example 2.4.0.");
  }

  return {
    kind: "missing",
    missing,
    context,
    summary: `I need ${missing.join(" and ")} before I can check a release. ${hints.join(" ")}`.trim(),
  };
}
