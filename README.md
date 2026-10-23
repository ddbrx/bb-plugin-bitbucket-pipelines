# Bitbucket Pipelines for BB

Launch and monitor Bitbucket Cloud pipelines through native agent tools, a CLI, and a visual dashboard in the BB sidebar.

## Install

Install directly from GitHub:

```sh
bb plugin install https://github.com/ddbrx/bb-plugin-bitbucket-pipelines
```

For local development:

```sh
npm ci --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install . --yes
```

Requires BB >=0.46 and Plugin SDK >=0.6.49. Supports Bitbucket Cloud; Data Center does not provide this Pipelines API.

## Connect

Open **Settings → Installed plugins → Bitbucket Pipelines**:

- Authentication: `api-token` for an Atlassian API token, or `bearer` for a repository/workspace/project access token.
- Atlassian account email: required for API token authentication.
- Token: stored as a BB secret setting, never sent to the dashboard.
- Default workspace and repository: optional slugs used by agents and the dashboard.

Give the token repository access and pipeline read/write permissions. API tokens need `read:pipeline:bitbucket` to inspect runs and `write:pipeline:bitbucket` to launch/stop them. Pipeline variables need no variable-management permission because they are supplied per launch.
See [Atlassian authentication](https://developer.atlassian.com/cloud/bitbucket/rest/intro/) and [Pipelines REST API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/).

## Dashboard

Open **Bitbucket Pipelines** in the sidebar. Accessible workspaces load automatically; choose one to list its repositories, then select a repository to load recent runs and its default branch. Use “More workspaces” or “More repositories” for additional pages. Discovery requires `read:workspace:bitbucket` and `read:repository:bitbucket` API token scopes (or equivalent access-token permissions). Workspace discovery uses the current `/user/workspaces` endpoint. For scoped tokens that cannot discover workspaces, use “Enter workspace manually” to discover repositories within that workspace. Full manual workspace/repository entry remains available without discovery permissions.

Load a workspace/repository, then launch a branch or tag pipeline, optionally choosing a custom pipeline name and commit. The custom name must exist under `pipelines.custom` in that reference's `bitbucket-pipelines.yml`.
Add runtime variables and choose whether Bitbucket should secure each value (on by default). Submitted variables are cleared after a successful launch and are never persisted by this plugin.

Recent runs show status, result, branch, commit, author, timestamp, and reported duration. Select a run for its first 100 steps, open its full Bitbucket view, or stop an active run. Twenty runs per page, refreshed every 15 seconds while the page is visible. Status comes directly from Bitbucket; network failures preserve the last displayed list and show an error.

## Agents and CLI

Native tools: `bitbucket_pipelines_workspaces`, `bitbucket_pipelines_repositories`, `bitbucket_pipelines_run`, `bitbucket_pipelines_list`, `bitbucket_pipelines_status`, `bitbucket_pipelines_stop`. New agent sessions receive the plugin's usage skill. All surfaces use the same validated service functions.

```sh
bb bitbucket-pipelines workspaces --json
bb bitbucket-pipelines repositories --workspace TEAM --json
bb bitbucket-pipelines list --json
bb bitbucket-pipelines run --ref main --custom deploy-staging --json
bb bitbucket-pipelines run --ref v1.0 --ref-type tag --json
bb bitbucket-pipelines get 123 --json
bb bitbucket-pipelines steps 123 --json
bb bitbucket-pipelines stop 123 --json
```

Override defaults using `--workspace TEAM --repo REPO`. Use `--page` on list. For variables, pass a JSON array of `{ "key": "ENVIRONMENT", "value": "staging", "secured": true }` via `--variables-stdin` from a secure source. Every command emits JSON; `--json` additionally enables structured CLI errors. Use `--help` for full argument details.

## Operating constraints

Only `api.bitbucket.org` is contacted for API requests. Redirects are refused. Requests time out after 20 seconds and are aborted when the plugin is disposed. Launch and stop requests are never retried automatically. If a launch is interrupted, inspect recent runs before retrying to avoid duplicate execution. Credentials and Bitbucket error bodies are not logged or included in responses. Pipeline responses are reduced to status metadata and safe Bitbucket links; runtime variable values are excluded.

Stopping or launching a pipeline may affect deployments and consume build minutes. Token access determines which repositories the plugin can operate on. No live Bitbucket launch is part of the automated test suite.
