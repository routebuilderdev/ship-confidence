# Confidence rubric

This file is a Forge resource, not code. It is served to the agent through the
`rovo:mcp` module's `resources` list, so its wording can be improved and
redeployed without touching the scoring logic in `src/domain/readiness.ts`.

## Verdict thresholds

| Verdict | Score | Meaning |
| --- | --- | --- |
| `ship` | 85-100 | No blocker-severity risk factors remain. |
| `ship_with_risk` | 60-84 | Nothing fatal, but at least one warning deserves a named owner. |
| `do_not_ship` | 0-59 | At least one blocker-severity risk factor is present. |
| `unverified` | - | Not enough data was readable to make a claim. |

## How to read the score

A score is a summary of evidence, not a probability. Two rules matter more than
the number:

1. **A blocker forces `do_not_ship` regardless of score.** The score is capped at
   59 whenever a blocker-severity factor exists.
2. **`unverified` is not a soft `ship`.** It means the app could not read enough
   of the release's context. Report it as unknown, never as ready.

## Coverage

Every result carries a `coverage` list. `read` means the source returned data
for this user. `empty` means it returned nothing. `not_permitted` means a scope
is missing and the emptiness is not evidence of safety. `unavailable` means the
query failed.

If any source is `not_permitted` or `unavailable`, say so explicitly when
summarising: "this does not cover deployments for you".

## What this rubric deliberately ignores

Velocity, story points, and individual performance. Those measure people, not
release risk, and an agent should not be asked to score colleagues.
