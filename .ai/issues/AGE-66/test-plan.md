# Test Plan

## Unit/API tests

- `tests/brain-api.test.ts`
  - Successful query returns citations with tier, freshness, confidence, and status metadata.
  - No-match query returns an empty citation set and an empty-state answer.
  - Forbidden/unknown principal returns a 403 error.
  - Candidate commit returns candidate atom, changeset, audit event, and preserves source/link metadata.

## Integration/build checks

- `npm test -- tests/brain-api.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`

## Manual smoke paths

- Dashboard query form shows loading and results.
- Dashboard query form shows empty state for a nonsense query.
- Dashboard commit form creates a candidate atom and review changeset.
- API rejects mismatched `x-tenant-id`.
