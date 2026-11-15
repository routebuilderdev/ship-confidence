import { describe, expect, it } from "vitest";

import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, QUERIES } from "../src/graph/queries";

describe("clampPageSize", () => {
  it("never asks for more than the curated query cap", () => {
    expect(clampPageSize(100)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(25)).toBe(25);
    expect(MAX_PAGE_SIZE).toBe(25);
  });

  it("defaults and clamps low values", () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-4)).toBe(1);
    expect(clampPageSize(7.8)).toBe(7);
  });

  it("keeps every query passing an explicit page size variable", () => {
    for (const [name, document] of Object.entries(QUERIES)) {
      expect(document, `${name} must accept $first`).toContain("$first: Int!");
      expect(document).toContain("first: $first");
    }
  });
});
