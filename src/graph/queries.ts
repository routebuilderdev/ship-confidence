/**
 * Teamwork Graph query documents.
 *
 * Every field and argument below was checked against this site's published SDL
 * (`GET https://<site>/gateway/api/graphql/twg/schema`) rather than the docs prose,
 * because the two disagreed twice. Notable, verified facts:
 *
 * - `JiraWorkItem` has NO fix-version field. Version membership is a *relationship*
 *   (`jira_version_links_jira_work_item`), reachable only through a persisted
 *   Cypher query — see `PERSISTED_RELEASE_SCOPE` below.
 * - Curated queries take ARIs: `jiraWorkItemComments(id:)`, `jiraWorkItemLinkedExternal*` etc.
 * - `first` never exceeds 25.
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

/**
 * The Cypher registered once against this app (POST /gateway/api/twg/cypher-queries).
 * Start from the space, walk to the release versions it owns, then to the work
 * items those versions link. Nothing here is sent as query text at runtime.
 */
export const PERSISTED_RELEASE_SCOPE = `
  MATCH (space:JiraSpace {key: $spaceKey})
        -[:jira_space_has_jira_release_version]->(version:JiraVersion {name: $versionName})
        -[:jira_version_links_jira_work_item]->(item:JiraWorkItem)
  RETURN item
`.trim();

/** Parameters declared when registering the query above. */
export const PERSISTED_RELEASE_SCOPE_PARAMS = [
  { name: "spaceKey", type: "STRING", required: true },
  { name: "versionName", type: "STRING", required: true },
] as const;

export function clampPageSize(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}

export const QUERIES = {
  /**
   * Work items linked to a release version, via the persisted Cypher query.
   *
   * The result is a Cypher connection, not a typed one: each row carries typed
   * `columns`, and the selected `RETURN item` column holds a `CypherQueryResultNode`
   * whose `data` is a `JiraWorkItem`.
   */
  versionWorkItems: `
    query ReleaseWorkItems($queryKey: String!, $queryParams: CypherRequestParams, $first: Int!) {
      customQuery(queryKey: $queryKey, queryParams: $queryParams, first: $first) {
        edges {
          node {
            columns {
              key
              value {
                ... on CypherQueryResultNode {
                  id
                  data {
                    ... on JiraWorkItem {
                      id
                      key
                      summary
                      issueType { name }
                      status { name statusCategory { key } }
                      webUrl
                      createdAt
                      resolvedAt
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,

  /**
   * Pull requests, deployments, builds and designs linked to one work item, in a
   * single call. Splitting these into separate curated queries doubled the round
   * trips for no benefit.
   */
  developmentArtifacts: `
    query WorkItemArtifacts($id: ID!, $first: Int!) {
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
    query WorkItemComments($id: ID!, $first: Int!) {
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
    query CoverageProbe($userId: ID!, $first: Int!) {
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
