# Test Plan

- `tests/connector-maintenance.test.ts`
  - Expired auth opens a reauthorization repair task.
  - Lag above threshold opens a checkpoint/replay repair task.
  - Repeated transform failures open a transform investigation task.
  - Offboarding export includes allowed individual-owned atoms and artifacts.
  - Offboarding revokes connected accounts and audits revocation.
  - Export is denied for a principal without audit/export authority.
  - API routes cover triage, offboarding, and status.

## Required Verification

- `npm test -- tests/connector-maintenance.test.ts`
- `npm run ci`
