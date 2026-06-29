# Test Plan

- Unit: missing skill evals block publication.
- Unit: unsafe write permission or exposed secret blocks security scan.
- Unit: missing adapter targets fails adapter generation check.
- Unit: no reviewer blocks publish even when checks pass.
- Unit/API: successful publish stores check results, publication, rollback metadata, and audit event.

## Verification commands

- `npm test -- tests/registry-publication.test.ts`
- `npm test -- tests/registry-publication.test.ts tests/registry-import.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
