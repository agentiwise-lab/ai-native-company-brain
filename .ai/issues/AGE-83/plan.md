# Implementation Plan

## Vertical slice

Add a tool invocation gateway that accepts a registry tool, principal, connected account, session purpose, and input. The gateway evaluates policy/rate/budget/approval gates before a pluggable executor is called, stores sanitized metadata, and emits audit events for every outcome.

## Design

- Add `lib/tool-invocation-gateway.ts`.
- Inputs: principal, tool definition, connected account id, package version, session purpose, args, budget, and approval flags.
- Policy checks: registry invocation policy, version match, account active, session available, rate limit, budget, approval required.
- Execution: pluggable executor for Composio-backed actions; default returns blocked unless configured.
- Sanitization: redact secret-like keys and sensitive response values in stored metadata.
- Add `POST /api/v1/tools/invoke` and `GET /api/v1/tools/invocations`.
- Add dashboard visibility for recent invocations.

## Non-goals

- No real Composio network execution in tests; the executor is injectable.
- No cron integration yet; AGE-86/87 will call the same gateway.
