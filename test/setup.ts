/**
 * Test environment.
 *
 * The loader refuses to guess a release's scope without a registered persisted
 * query key, so tests supply one. It is not a secret and never leaves the fake client.
 */
process.env.SHIP_CONFIDENCE_TWG_QUERY_KEY = "test-query-key";
