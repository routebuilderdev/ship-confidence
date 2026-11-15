# Setup

Two paths: **install it** (5 minutes, for someone evaluating the app) or **build it from
source** (for development).

## What you need

| Requirement | Notes |
| --- | --- |
| A Jira Cloud site | Any plan. A **free developer site** is enough — see [Part 2](#part-2--build-from-source-on-a-free-site) |
| Admin rights on that site | Needed once, to install the app and to expose the tools |
| Node.js 22 or newer | Only if building from source |
| An MCP-capable client | Optional. Only needed to reach the tools; the Jira page works without one |

**No Rovo licence and no paid plan are required.** External AI clients reach this app's
tools through the Atlassian MCP server, which any site admin can enable per app. Rovo
Studio agents are a *separate* way in, and those do need Rovo.

---

## Part 1 — Install and use

### 1. Install the app

From the Marketplace listing, or from source with `forge install` (Part 2, step 5).
Install it on **Jira only**.

> Do not also install it on Confluence. A current platform behaviour means an app
> connected to both can fail to expose its tools, with no useful error. See
> [Troubleshooting](#troubleshooting).

### 2. Open the project page

In Jira, open a project and pick **Ship Confidence** in the project sidebar. It lists
that project's versions and scores the next unreleased one.

The verdict is one of four:

| Verdict | Meaning |
| --- | --- |
| `ship` | Score 85–100. Nothing blocking was found in the data that could be read |
| `ship_with_risk` | Score 60–84. Real warnings, no hard blocker |
| `unverified` | **No work items were visible for that version.** This is "I could not see it", not "it is fine" |

A single blocker caps the score at 59 no matter what else is clean.

### 3. Expose the tools to AI clients (optional)

**Off by default.** Until an admin turns it on, the app deploys and installs normally but
is invisible to every MCP client — with no error anywhere.

> **Atlassian Administration → Apps → Sites → _your site_ → Connected apps →
> Ship Confidence → Tools** → enable the tools.

Tools can be enabled individually, which is how you keep a read-only surface read-only.

The endpoint clients connect to is:

```
https://mcp.atlassian.com/forge/<appId>
```

`<appId>` is the UUID part of `app.id` in `manifest.yml` (the value `forge register`
produced). Check it with:

```bash
grep "id: ari:cloud:ecosystem::app/" manifest.yml
```

### 4. Connect a client

Each client completes an OAuth consent screen on first use — the tools then run with the
**signed-in user's** permissions, not the app's.

**MCP Inspector** (no account needed — good for a quick check):

```bash
npx @modelcontextprotocol/inspector
```

Choose transport **Streamable HTTP**, paste the endpoint, connect, and authenticate.

**VS Code** — add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "ship-confidence": {
      "type": "http",
      "url": "https://mcp.atlassian.com/forge/<appId>"
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add --transport http ship-confidence https://mcp.atlassian.com/forge/<appId>
```

Then `/mcp` inside the session to complete consent.

### 5. Try it

```
Is SHIP 2.4.0 safe to ship?
What is blocking SHIP 2.4.0?
Why is SHIP-442 blocking?
Draft release notes for SHIP 2.4.0.
Why does 2.5.0 score worse than 2.4.0?
```

Every tool takes `projectKey` and `versionName`; `explain-blocker` also takes
`workItemKey` or `blockerId`; `compare-releases` takes a `baselineVersionName`.

---

## Registering the release-scope query (once per app)

The graph exposes version membership as a relationship, and a version is filtered by
its `ari` — not by its name. So the app runs one registered query and turns the
version the user named into an ARI first.

Submit this once, signed in as a contributor on the app:

```bash
curl -X POST "https://<site>.atlassian.net/gateway/api/twg/cypher-queries" \
  -u "<email>:<api-token>" \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{"appId":"ari:cloud:ecosystem::app/<appId>","name":"release-scope","cypher":"MATCH (version:JiraVersion {ari: $versionAri})-[:jira_version_links_jira_work_item]->(item:JiraWorkItem) RETURN item","paramsSchema":[{"name":"versionAri","type":"ARI","required":true}]}
JSON
```

It answers `201` with a `queryKey`, or `200` if that exact text was already registered
(registration is idempotent). Allow about a minute before the key works — until then
execution returns `QUERY_NOT_FOUND`.

Store it:

```bash
forge variables set -e production SHIP_CONFIDENCE_TWG_QUERY_KEY <queryKey>
```

Without a key the page says so instead of scoring an empty release.

---

## Part 2 — Build from source on a free site

### 1. Create the free site

1. Go to `go.atlassian.com/cloud-dev` and sign up.
2. Pick a site name — this becomes `<site>.atlassian.net`.
3. Choose **Jira Software**. The bundle adds Confluence and JSM; leave them alone and
   install nothing on Confluence.
4. Verify your email and let the site finish provisioning. You are the **org admin** of
   your own site.

Developer sites are free permanently, not trials. Prefer a custom/company email domain:
Rovo will not activate on a generic consumer domain, and that closes off the Rovo Studio
route permanently.

### 2. Install the CLI

```bash
npm install -g @forge/cli@latest
forge --version      # requires Node 22+
```

### 3. Log in and register

```bash
forge login          # opens a browser once; approve, then return to the terminal
forge register       # writes a real app.id into manifest.yml
```

`forge register` is interactive on first run: give it a name (`ship-confidence`) and it
replaces the placeholder `app.id`. Commit the result.

### 4. Check, then deploy

```bash
npm install
npm run verify       # tsc --noEmit + vitest, no network needed
forge lint
forge deploy
```

`forge deploy` must run before `forge install`. Use `forge deploy -e development` if you
want a separate environment.

### 5. Install on your site

```bash
forge install        # choose Jira, then enter <site>.atlassian.net
```

### 6. Live development (optional)

```bash
forge tunnel         # local code, remote runtime, no redeploy per change
```

Note the tunnel runs your code where the platform's time budgets still apply: 55 s per
tool call, **25 s for the project page resolver**.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "…is not allowed to expose its tools over the external MCP endpoint on this site" | The app is installed on both Jira and Confluence. Uninstall from Confluence, then toggle the tools off and on |
| Endpoint returns 404 | Wrong `<appId>`, or the app is not installed on that site |
| Client connects, tool list is empty | Tools are disabled in Connected apps, or the OAuth user cannot access the project |
| Verdict is `unverified` on a version that has issues | No work items carry that **fix version**, or the graph scopes returned nothing. A missing scope does not raise an error — it returns empty. Check the coverage output in the tool result |
| Score is exactly 59 | A blocker is present; 59 is the cap. `list-open-blockers` names them |
| Every source reads `not_permitted` | The signed-in user cannot read those objects, or the site has not granted the app its `read:graph:*` scopes (requires an org admin) |
| `forge deploy` succeeds but nothing changes | `forge install` upgrades the installed version only when run again, or use `forge install --upgrade` |

---

## Uninstall

```bash
forge uninstall --site <site>.atlassian.net
```

Then remove the app from **Atlassian Administration → Apps** if it is still listed.
