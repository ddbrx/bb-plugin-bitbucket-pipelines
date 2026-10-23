# Bitbucket Pipelines

A BB plugin for Bitbucket Cloud pipeline launches, status, step inspection and cancellation. The dashboard discovers accessible workspaces and repositories automatically, with manual entry for scoped tokens.

- `server.ts`: settings, RPC, agent tools, and CLI registration.
- `contract.ts`: shared input/output validation.
- `bitbucket.ts`: API client, authentication, request payloads, and safe response mapping.
- `app.tsx`: sidebar dashboard with repository selection, launch form and polling.
- `skills/bitbucket-pipelines`: agent usage instructions.
- `tests/`: validation, authentication, request, and response safety checks.

See README.md for installation and credential setup.
