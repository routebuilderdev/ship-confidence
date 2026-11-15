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

export interface TeamworkGraphClient {
  request<T>(document: string, variables: Record<string, unknown>): Promise<GraphResult<T>>;
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
