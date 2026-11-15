/**
 * Teamwork Graph query documents.
 *
 * These use *curated queries* (the typed, registered-free layer), not raw Cypher.
 * Curated queries are Relay-style: `edges { node }` plus
 * `pageInfo { hasNextPage endCursor }`, and `first` is hard-capped at 25 — asking
 * for more is an error, not a truncation.
 *
 * VALIDATE BEFORE DEPLOY: field names below come from Atlassian's curated query
 * list, but the exact argument shapes must be checked against the Query Builder
 * (https://teamwork-graph.atlassian.com/query-builder) for your site. This file is
 * the only place queries live, precisely so that check is a one-file diff.
 */

/** Platform cap. Not a preference. */
export const MAX_PAGE_SIZE = 25;
export const DEFAULT_PAGE_SIZE = 25;

export function clampPageSize(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}

export const QUERIES = {
  /**
   * Work items in scope for a version. `jiraSpaceWorkItems` is the curated entry
   * point for project/space scoped issues.
   */
  workItems: `
    query ReleaseWorkItems($projectKey: String!, $first: Int!) {
      jiraSpaceWorkItems(projectKey: $projectKey, first: $first) {
        edges {
          node {
            key
            summary
            issueType
            url
            updatedAt
            assignee { accountId }
            status { name category }
            fixVersions { name }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,

  /** External pull requests linked to work items, for "done" claims to be checked. */
  pullRequests: `
    query ReleasePullRequests($projectKey: String!, $first: Int!) {
      jiraSpaceWorkItems(projectKey: $projectKey, first: $first) {
        edges {
          node {
            key
            linkedExternalPullRequests {
              id
              title
              state
              url
              reviewDecision
            }
          }
        }
      }
    }
  `,

  /** External deployments linked to work items. */
  deployments: `
    query ReleaseDeployments($projectKey: String!, $first: Int!) {
      jiraSpaceWorkItems(projectKey: $projectKey, first: $first) {
        edges {
          node {
            key
            linkedExternalDeployments {
              id
              environment
              status
              url
            }
          }
        }
      }
    }
  `,

  /**
   * Access probe, run only when the work-item answer came back empty.
   * One item is enough: the question is "can this user read issues at all", not
   * "what are they working on".
   */
  probe: `
    query CoverageProbe($first: Int!) {
      atlassianUserAssignedJiraWorkItems(first: $first) {
        edges {
          node { key }
        }
      }
    }
  `,

  /** Comment activity, bounded to the recent past so a big project stays cheap. */
  reviewSignals: `
    query ReleaseComments($projectKey: String!, $first: Int!) {
      jiraWorkItemComments(projectKey: $projectKey, since: P30D, first: $first) {
        edges {
          node {
            id
            body
            created
            workItemKey
          }
        }
      }
    }
  `,
} as const;
