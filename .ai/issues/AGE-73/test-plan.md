# Test Plan

## Tests

- `tests/flexible-composio-ingestion.test.ts`
  - Notion sync: selected pages/databases/comments normalize into source artifacts with unsupported block metadata.
  - Webhook valid signature: signed payload becomes a governed source artifact with provenance, ACL hints, and raw content.
  - Invalid signature: webhook is rejected before artifact write.
  - Malformed payload: webhook validation fails with a useful error.
  - Duplicate webhook: repeated payload dedupes through the shared ingestion path.
  - Revoked Notion account: sync fails before client calls.
  - Disable/replay state: source state can be disabled and replayed as operator metadata.
  - Review/query path: synced Notion/webhook artifact can be committed, approved, merged, and queried with citations.

## Integration/build checks

- `npm test -- tests/flexible-composio-ingestion.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
