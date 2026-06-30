# Test Plan

- `tests/identity-org-sync.test.ts`
  - SAML/SCIM configuration persists and audits config.
  - SCIM user create/update/deactivate derives access from group mappings.
  - Group changes update brain tiers, registry visibility, and reviewer mappings.
  - Deactivated reviewer is remapped to another eligible reviewer.
  - Deactivated user is denied UI/API/MCP and Composio session/tool execution.
  - SCIM replay suppresses duplicate effects.
  - API routes cover configure, sync, and status.

## Required Verification

- `npm test -- tests/identity-org-sync.test.ts`
- `npm run ci`
