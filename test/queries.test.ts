import { describe, expect, it } from "vitest";

import {
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PERSISTED_RELEASE_SCOPE,
  PERSISTED_RELEASE_SCOPE_PARAMS,
  QUERIES,
  versionAri,
} from "../src/graph/queries";

describe("persisted release scope", () => {
  it("matches versions on ari, which is the only filterable property", () => {
    expect(PERSISTED_RELEASE_SCOPE).toContain("(version:JiraVersion {ari: $versionAri})");
    // A version's name is a returned field, not a query property: filtering on it
    // fails validation at registration time.
    expect(PERSISTED_RELEASE_SCOPE).not.toContain("$versionName");
    expect(PERSISTED_RELEASE_SCOPE).not.toContain("$spaceKey");
  });

  it("declares every placeholder it uses", () => {
    for (const param of PERSISTED_RELEASE_SCOPE_PARAMS) {
      expect(PERSISTED_RELEASE_SCOPE).toContain(`$${param.name}`);
    }
    expect(PERSISTED_RELEASE_SCOPE_PARAMS).toHaveLength(1);
    expect(PERSISTED_RELEASE_SCOPE_PARAMS[0].type).toBe("ARI");
  });

  it("builds the ari the graph expects for a version", () => {
    expect(versionAri("cloud-1", "10001")).toBe("ari:cloud:jira:cloud-1:version/10001");
  });
});

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
