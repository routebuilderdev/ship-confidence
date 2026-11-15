---
name: ship-confidence
description: Use when someone asks whether a Jira version is ready to release, what is blocking it, why a specific work item blocks it, or asks for release notes. Queries release readiness, blockers and risk factors, and must report data coverage honestly.
---

# Ship Confidence

Six read-only tools answer the question "is this release safe to ship?" by
correlating Jira work items with linked pull requests, deployments and review
comments. Every tool returns a `summary` (a complete sentence), `data`,
`coverage` and `warnings`.

## Pick the tool by question, not by convenience

| The user asks | Call |
| --- | --- |
| "Is 2.4.0 ready / can we ship / how risky is this release" | `get-release-readiness` |
| "What's blocking us / what's left" | `list-open-blockers` |
| "Why did the score drop / show me everything" | `get-release-risk-factors` |
| "Why is SHIP-442 blocking us" | `explain-blocker` with `workItemKey` |
| "Write the release notes / changelog" | `draft-release-notes` |
| "Why is 2.5.0 worse than 2.4.0 / what changed between releases" | `compare-releases` with `baselineVersionName` |

A typical conversation is readiness first, then a drill-down, then notes. Do not
call every tool to answer one question.

## Answer shape

1. Lead with the verdict in plain words: safe, safe with risk, not ready, or
   unknown.
2. Give the score and the specific reasons, not the factor count alone.
3. If the user asked about a blocker, name the work item and link it.
4. If `warnings` is non-empty, repeat the coverage caveat **before** any
   reassurance. Never bury it.

## Non-negotiable rules

- **`verdict: "unverified"` means unknown, never "probably fine".** Say "I could
  not read enough to answer", not "looks clear".
- **`coverage` statuses matter.** `read` and `empty` are answers. `not_permitted`
  and `unavailable` are blind spots, and the user must hear about them.
- **Never invent a work item key, version name, or deployment.** If a tool asks
  for a missing input, ask the user.
- **Do not restate the score as a probability.** It summarises evidence; it is not
  a chance of success.
- **Do not score people.** The tools deliberately ignore velocity, story points
  and individual performance. If asked to rank colleagues, decline and offer the
  release risk view instead.

## When data looks wrong

- Empty work items plus a `not_permitted` coverage entry means a scope is missing,
  not that the release is empty. Tell the user which source is unreadable and that
  it needs a site or project admin to grant access.
- An open pull request on a work item marked done is the normal contradiction this
  app exists to surface. Report both facts; do not assume which one is stale.
- A version name that matches nothing is usually a typo or a version that has not
  been created. Offer the closest-looking name only if a tool returned one.

## What this skill does not do

No writes: it cannot transition issues, merge pull requests, deploy, or comment.
No historical trends: each answer describes the release as it is now.
