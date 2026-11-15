/**
 * Teamwork Graph query documents.
 *
 * Every field and argument below was checked against this site's published SDL
 * (`GET https://<site>/gateway/api/graphql/twg/schema`) rather than the docs prose,
 * because the two disagreed twice. Notable, verified facts:
 *
 * - `JiraWorkItem` has NO fix-version field. Version membership is a relationship in
 *   the graph, reachable only through a Cypher query that must be registered from a
 *   browser session, so release scope comes from Jira search instead and the graph
 *   is used for everything per-item.
 * - Curated queries take ARIs: `jiraWorkItemComments(id:)`, `jiraWorkItemLinkedExternal*` etc.
 * - `first` never exceeds 25.
 * - Every operation needs a name shaped `[company]_[operation]` (company 3+ chars,
 *   operation 4+). Unnamed or badly named operations come back as a 200 carrying a
 *   DataFetchingException, so checking `ok` alone reports success on a failed read.
 * - Result nodes are unions, so every selection uses an inline fragment.
 */

/** Platform cap. Not a preference. */
export const MAX_PAGE_SIZE = 25;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * How many work items get per-item follow-up queries (development artefacts and
 * comments). Each item costs two round trips, and the project page resolver only
 * has 25 s for everything, so the tail is reported as unread rather than fetched.
 */
export const ENRICHED_ITEM_LIMIT = 8;

/** Graph id of a work item, built from what Jira REST reports. */
export function issueAri(cloudId: string, issueId: string): string {
  return `ari:cloud:jira:${cloudId}:issue/${issueId}`;
}

export function clampPageSize(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}

export const QUERIES = {
  /**
   * Pull requests, deployments, builds and designs linked to one work item, in a
   * single call. Splitting these into separate curated queries doubled the round
   * trips for no benefit.
   */
  developmentArtifacts: `
    query ship_releaseArtifacts($id: ID!, $first: Int!) {
      jiraWorkItemDevelopmentArtifacts(id: $id, first: $first) {
        edges {
          node {
            ... on ExternalPullRequest {
              id
              title
              displayName
              url
              status
              reviewers { approvalStatus }
            }
            ... on ExternalDeployment {
              id
              displayName
              url
              state
              environment { displayName type }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `,

  /** Comments on one work item, bounded to the recent past so a busy item stays cheap. */
  comments: `
    query ship_releaseComments($id: ID!, $first: Int!) {
      jiraWorkItemComments(id: $id, since: "P30D", first: $first) {
        edges {
          node {
            ... on JiraWorkItemComment {
              id
              content
              createdAt
              webUrl
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `,

  /**
   * Access probe, run only when the version came back with no work items.
   * `userId` must be an identity ARI: ari:cloud:identity::user/<accountId>.
   */
  probe: `
    query ship_coverageProbe($userId: ID!, $first: Int!) {
      atlassianUserAssignedJiraWorkItems(userId: $userId, first: $first) {
        edges {
          node {
            ... on JiraWorkItem { key }
          }
        }
      }
    }
  `,
} as const;

/** Identity ARI for the probe, from a bare account id. */
export function userAri(accountId: string): string {
  return `ari:cloud:identity::user/${accountId}`;
}
