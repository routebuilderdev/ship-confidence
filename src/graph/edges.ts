/**
 * Curated queries return Relay connections. The field name depends on the entry
 * point, so connections are found structurally instead of guessed by name.
 *
 * Lives in its own module because both the loader and the coverage probe need it,
 * and the probe must not import the loader (that would be a cycle).
 */
export function edgesOf(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];

  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (value && typeof value === "object" && "edges" in value) {
      const edges = (value as { edges?: unknown }).edges;
      if (Array.isArray(edges)) {
        return edges.map((edge) =>
          edge && typeof edge === "object" && "node" in edge
            ? (edge as { node: unknown }).node
            : edge,
        );
      }
    }
  }
  return [];
}
