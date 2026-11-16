# Privacy policy — Ship Confidence

Ship Confidence is a read-only release gate for Jira. This policy describes exactly
what it reads, what it stores, and where it runs.

## What the app reads

When a user asks for a release verdict or opens the project page, the app reads from
the Atlassian Teamwork Graph and the Jira REST API, using the installing site's
permissions:

- Jira work items in the scored version: key, summary, type and status
- The display names of the people assigned to those work items, and the authors of
  comments on them
- Pull requests and deployments linked to those work items
- Comment bodies on those work items, limited to the last 30 days

All access is performed with the permissions of the user who triggered the request
or the user whose site is installed. The app cannot read anything that user cannot.

## What the app stores

Nothing.

The app has no database, no cache and no storage module. Every request is answered
from live data and the result is returned to the caller. No personal data — including
account IDs, names, email addresses or comment text — is copied into app storage,
logged to a persistent location, or retained after the request completes.

## What the app writes

Nothing. Every tool is defined as a read-only action and the app declares no write
scopes. It does not transition, merge, deploy, comment on, or otherwise modify any
Atlassian data.

## Third parties

The app sends no data to any third party. There is no analytics, no telemetry, and
no external service call other than Atlassian's own APIs. If a user connects an AI
client to the app's MCP endpoint, the tool results are returned to that client, and
that client's own privacy policy governs what happens to them.

## Data retention and deletion

Because nothing is stored, there is nothing to retain or delete. Uninstalling the app
removes it from the site and ends all access.

## Contact

Questions about this policy: routebuilderdev@gmail.com
