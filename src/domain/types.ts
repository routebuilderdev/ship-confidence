/**
 * Domain types.
 *
 * These describe the *problem* (what a release looks like), not the transport.
 * Nothing in this folder may import `@forge/api`, fetch, or read process env:
 * that keeps the scoring logic unit-testable without mocking the Forge runtime.
 */

export type WorkItemStatus = "todo" | "in_progress" | "done" | "unknown";

export interface WorkItem {
  key: string;
  summary: string;
  status: WorkItemStatus;
  issueType: string;
  url?: string;
  assigneeAccountId?: string;
  /** Present when the item is explicitly flagged as blocked. */
  blockedReason?: string;
  updatedAt?: string;
  /** Jira fix versions. Used to scope items to the release being asked about. */
  fixVersions?: string[];
}

export type PullRequestState = "open" | "merged" | "declined" | "unknown";

export interface LinkedPullRequest {
  id: string;
  title: string;
  state: PullRequestState;
  url?: string;
  /** The work item this pull request is linked to, when known. */
  workItemKey?: string;
  reviewDecision?: "approved" | "changes_requested" | "pending" | "unknown";
}

export type DeploymentStatus = "successful" | "failed" | "running" | "unknown";

export interface LinkedDeployment {
  id: string;
  environment: string;
  status: DeploymentStatus;
  url?: string;
  workItemKey?: string;
}

export interface ReviewSignal {
  kind: "unresolved_comment" | "changes_requested" | "stale";
  workItemKey: string;
  detail: string;
}

/**
 * Everything the scorer is allowed to look at. Built once per tool call by
 * `src/graph/load.ts`, which is the only place that knows about GraphQL.
 */
export interface ReleaseContext {
  projectKey: string;
  versionName: string;
  workItems: WorkItem[];
  pullRequests: LinkedPullRequest[];
  deployments: LinkedDeployment[];
  reviewSignals: ReviewSignal[];
}
