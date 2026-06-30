# Test Plan

- `tests/cloud-control-plane.test.ts`
  - Provisions tenant, admin, managed database/storage/queue/secrets, identity settings, Composio handoff, diagnostics, and first connected-source next action.
  - Rolls back and audits failed provisioning.
  - Enforces tenant isolation and records deny decisions.
  - Rotates tenant secret refs.
  - Exports cloud tenant data in self-host-compatible API, MCP, registry package, and export formats.
  - API routes cover create/list, diagnostics, secret rotation, and self-host export.

## Required Verification

- `npm test -- tests/cloud-control-plane.test.ts`
- `npm run ci`
