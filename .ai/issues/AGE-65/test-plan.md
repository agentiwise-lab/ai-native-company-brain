# Test Plan

## Unit tests

- `tests/composio-control-plane.test.ts`
  - Rejects validation when API credentials are missing.
  - Reuses an existing active session for the same principal, purpose, toolkits, and connected accounts.
  - Blocks session creation against revoked connected accounts.
  - Surfaces unavailable toolkit discovery failures.
  - Maps discovered Composio actions into internal `ToolDefinition` registry candidates with owner, tier, permissions, and audit policy.

## Integration/build checks

- `npm test -- tests/composio-control-plane.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`

## Manual smoke paths

- `GET /api/v1/composio/config`
- `POST /api/v1/composio/config`
- `GET /api/v1/composio/accounts`
- `POST /api/v1/composio/accounts`
- `POST /api/v1/composio/sessions`
- `POST /api/v1/composio/toolkits/discover`
