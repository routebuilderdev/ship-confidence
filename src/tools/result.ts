import type { CoverageEntry } from "../graph/coverage";

/**
 * The one shape every tool returns.
 *
 * The agent turns this into prose, so `summary` is a complete sentence that stands
 * on its own. `coverage` and `warnings` are not decoration: they are how the app
 * stays honest when it cannot see part of the picture.
 */
export interface ToolResult {
  ok: boolean;
  summary: string;
  coverage: CoverageEntry[];
  warnings: string[];
  data?: unknown;
}

export interface ToolResultInput {
  ok: boolean;
  summary: string;
  coverage?: CoverageEntry[];
  warnings?: string[];
  data?: unknown;
}

export function buildResult(input: ToolResultInput): ToolResult {
  return {
    ok: input.ok,
    summary: input.summary.trim(),
    coverage: input.coverage ?? [],
    warnings: input.warnings ?? [],
    ...(input.data === undefined ? {} : { data: input.data }),
  };
}

/** For "I could not answer, and here is what was wrong" without inventing data. */
export function failureResult(summary: string, coverage: CoverageEntry[] = []): ToolResult {
  return buildResult({ ok: false, summary, coverage });
}
