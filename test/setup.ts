import { vi } from "vitest";

/**
 * Test environment.
 *
 * The loader refuses to guess a release's scope without a registered persisted
 * query key, so tests supply one. It is not a secret and never leaves the fake client.
 */
process.env.SHIP_CONFIDENCE_TWG_QUERY_KEY = "test-query-key";

/**
 * Version resolution asks Jira REST for the project's versions. Tests never touch
 * the network, so `@forge/api` is replaced with a fixed list that covers the
 * versions the fixtures use.
 */
vi.mock("@forge/api", () => {
  const versions = [
    { id: "10000", name: "2.4.0", released: false, releaseDate: "2026-02-01" },
    { id: "10001", name: "2.5.0", released: false, releaseDate: "2026-03-01" },
  ];

  const requestJira = async () => ({
    ok: true,
    status: 200,
    json: async () => versions,
  });

  return {
    default: { asUser: () => ({ requestJira }), asApp: () => ({ requestJira }) },
    route: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((path, part, index) => `${path}${part}${values[index] ?? ""}`, ""),
  };
});
