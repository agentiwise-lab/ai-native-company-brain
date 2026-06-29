# Test Plan

- Unit: allowed action executes through active connected account/session and stores sanitized metadata.
- Unit: forbidden write action for employee is denied before execution.
- Unit: revoked account blocks invocation and emits audit.
- Unit: rate limit blocks repeated calls.
- Unit: approval-required action returns needs-approval without execution.
- Unit/API: secret-looking inputs and outputs are redacted.

## Verification commands

- `npm test -- tests/tool-invocation-gateway.test.ts`
- `npm test -- tests/tool-invocation-gateway.test.ts tests/mcp-auth.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
