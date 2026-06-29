# Test Plan

## Tests

- `tests/mcp-auth.test.ts`
  - Unauthorized client receives JSON-RPC auth error.
  - Authorized initialize returns principal-scoped server info.
  - `tools/list` returns allowed built-ins and allowed Composio-backed registry tools only.
  - `brain.query` returns cited, ACL-filtered results for the authenticated principal.
  - Forbidden tool invocation returns a policy denial.
  - Revoked connected account blocks Composio-backed tool invocation.

## Integration/build checks

- `npm test -- tests/mcp-auth.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
