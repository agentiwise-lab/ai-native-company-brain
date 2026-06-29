# Test Plan

## Tests

- `tests/google-composio-ingestion.test.ts`
  - Large Drive doc: bounded normalized text, source URL, authors, modified date, and ACL metadata are preserved.
  - Gmail thread: message structure, labels, senders, timestamps, and attachments/unsupported formats are preserved.
  - Incremental sync: prior checkpoint cursor is reused and changed docs update the artifact.
  - Revoked account: sync fails before client calls or artifact writes.
  - Missing scope: Drive or Gmail sync is blocked when selected source scope is not allowed.
  - Duplicate sync: repeated Drive/Gmail payloads dedupe through the shared ingestion path.
  - Review/query path: synced Google artifact can be committed, approved, merged, and queried with citations.

## Integration/build checks

- `npm test -- tests/google-composio-ingestion.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
