# Handoff For AGE-74

## Checkpoint 2026-06-29

- Branch: `harshit/all-linear-issues-buildout`
- Current phase: implementation complete and locally verified.
- Added MCP authentication with bearer/header API key context tied to tenant and principal.
- Scoped `tools/list` by principal scopes and denied forbidden `tools/call` requests with JSON-RPC policy errors.
- Routed `brain.query`, `brain.commit`, `registry.search`, `skill.resolve`, `cron.run_now`, `audit.trace`, and `tool.invoke` through authenticated context.
- Added revoked connected-account denial for `tool.invoke` and registry policy checks for allowed tools.
- Added `npm run mcp:smoke` local smoke client for initialize, tools/list, cited query, denied write, and revoked-account denial.
- Verification passed: `npm test -- tests/mcp-auth.test.ts`, `npm run mcp:smoke`, `npm run typecheck`, `npm test`, and `npm run ci`.
- Next step: commit, push, wait for GitHub Actions, then mark AGE-74 Done in Linear.
