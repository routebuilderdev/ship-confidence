import { describe, expect, it } from "vitest";

import {
  caveat,
  entry,
  interpretProbe,
  isComplete,
  isPermissionMessage,
} from "../src/graph/coverage";

describe("coverage", () => {
  it("treats empty as a real answer and missing scope as not complete", () => {
    expect(isComplete([entry("workItems", "read"), entry("deployments", "empty")])).toBe(true);
    expect(isComplete([entry("workItems", "read"), entry("deployments", "not_permitted")])).toBe(
      false,
    );
  });

  it("returns no caveat when everything was readable", () => {
    expect(caveat([entry("workItems", "read"), entry("deployments", "empty")])).toBeUndefined();
  });

  it("names the missing sources and says they are unknown, not clear", () => {
    const message = caveat([
      entry("workItems", "read"),
      entry("deployments", "not_permitted"),
      entry("pullRequests", "unavailable"),
    ]);
    expect(message).toContain("deployments (not permitted for this user)");
    expect(message).toContain("linked pull requests (query failed)");
    expect(message).toContain("unknown, not as clear");
  });

  it("classifies probe results", () => {
    expect(interpretProbe({ count: 3, errors: [] })).toBe("read");
    expect(interpretProbe({ count: 0, errors: [] })).toBe("empty");
    expect(interpretProbe({ count: 0, errors: [{ message: "Missing scope: read:graph:issue:jira" }] })).toBe(
      "not_permitted",
    );
    expect(interpretProbe({ count: 0, errors: [{ message: "Internal server error" }] })).toBe(
      "unavailable",
    );
  });

  it("recognises the ways a permission failure is worded", () => {
    for (const message of [
      "Missing scope",
      "You do not have permission",
      "403 Forbidden",
      "Unauthorized",
      "Not allowed to read this",
    ]) {
      expect(isPermissionMessage(message)).toBe(true);
    }
    expect(isPermissionMessage("Query timed out")).toBe(false);
  });
});
