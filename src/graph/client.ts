import { isPermissionMessage } from "./coverage";

/**
 * The port the domain talks to. Deliberately tiny: one method, one result shape.
 * Adapters (Forge, fixtures) live outside this file so nothing here imports
 * platform SDKs and unit tests need no runtime mocks.
 */
export interface GraphError {
  message: string;
}

export interface GraphResult<T> {
  data?: T;
  errors: GraphError[];
}

export interface ReleaseScopeResult {
  /** Work items in the release, in the shape the graph returns them. */
  nodes: unknown[];
  /** Set when the scope could not be read at all. */
  error?: GraphError;
  /** True when the error was a permission refusal rather than a failure. */
  notPermitted?: boolean;
}

export interface TeamworkGraphClient {
  request<T>(document: string, variables: Record<string, unknown>): Promise<GraphResult<T>>;
  /**
   * Which work items belong to one release version.
   *
   * This is the one question the graph cannot answer for us: a version's membership
   * exists only as a relationship, reachable through a Cypher query that has to be
   * registered in a browser session (an app identity is refused with `scope does not
   * match`). Jira's own search answers it directly, and everything else — pull
   * requests, deployments, comments — still comes from the graph.
   */
  searchRelease(
    projectKey: string,
    versionName: string,
    cloudId: string | undefined,
  ): Promise<ReleaseScopeResult>;
}

/** Per-query budget. The action itself has 55s; leave room to format and return. */
export const QUERY_TIMEOUT_MS = 12_000;

export class QueryTimeoutError extends Error {
  constructor(documentName: string) {
    super(`Teamwork Graph query "${documentName}" exceeded ${QUERY_TIMEOUT_MS}ms`);
    this.name = "QueryTimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  documentName: string,
  ms: number = QUERY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new QueryTimeoutError(documentName)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function looksLikePermissionFailure(errors: GraphError[]): boolean {
  return errors.length > 0 && isPermissionMessage(errors.map((e) => e.message).join(" "));
}
