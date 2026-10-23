---
name: bitbucket-pipelines
description: Launch, inspect, and stop Bitbucket Cloud pipelines from BB.
---
Use native bitbucket_pipelines_run/list/status/stop tools or `bb bitbucket-pipelines`.
Launch pipelines only within the user's requested work; custom pipelines can deploy code.
Read workspace and repository defaults from plugin settings by omitting them, or pass explicit slugs.

Commands:
- `bb bitbucket-pipelines list [--workspace team --repo app] [--page 1] --json`
- `bb bitbucket-pipelines run --ref main [--custom deploy-staging] [--ref-type branch|tag] [--commit HASH] --json`
- `bb bitbucket-pipelines get BUILD_NUMBER_OR_UUID --json`
- `bb bitbucket-pipelines steps BUILD_NUMBER_OR_UUID --json`
- `bb bitbucket-pipelines stop BUILD_NUMBER_OR_UUID --json`

Runtime variables: `--variables` accepts a JSON array of {key,value,secured}; secured defaults to true.
Prefer `--variables-stdin` with a secure source for sensitive values. Avoid placing secrets in arguments or chat.
Never print credentials. Configure tokens using BB's secret plugin settings UI.
After an interrupted launch, list runs before retrying: the original request may have succeeded.
List results are bounded to twenty per page; steps are bounded to the first hundred.
The visual dashboard is in the Bitbucket Pipelines sidebar page. It refreshes every fifteen seconds while visible.
