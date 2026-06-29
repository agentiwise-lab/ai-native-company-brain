# Test Plan

## Tests

- `tests/composio-ingestion.test.ts`
  - Create: a Composio result becomes a persisted normalized source artifact with raw payload, normalized text, metadata, checkpoint, and audit event.
  - Update: same source object with changed checksum updates the existing artifact and records an update run.
  - Duplicate: same source object and checksum is skipped and preserves checkpoint.
  - Failed transform: missing source object id or normalized text records a failed run.
  - Revoked connected account: ingestion is blocked before artifact creation.

## Integration/build checks

- `npm test -- tests/composio-ingestion.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
