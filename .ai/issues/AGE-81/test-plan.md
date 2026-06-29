# Test Plan

- Unit: valid skill import creates a draft registry changeset and preview metadata.
- Unit: malformed manifest returns actionable validation errors.
- Unit: missing owner blocks import.
- Unit: dependency mismatch and missing required tool are reported.
- Unit: duplicate slug/version import is rejected.
- API: import and list routes expose the draft import state.

## Verification commands

- `npm test -- tests/registry-import.test.ts`
- `npm test -- tests/registry-import.test.ts tests/brain-api.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
