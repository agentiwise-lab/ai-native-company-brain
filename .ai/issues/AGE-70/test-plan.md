# Test Plan

## Tests

- `tests/slack-composio-ingestion.test.ts`
  - Backfill: selected channel history becomes normalized Slack source artifacts with provenance, authorship, channel context, ACL/sensitivity, checkpoint, and run summary.
  - Incremental sync: cursor/date checkpoint limits the next sync and updates artifacts through the shared pipeline.
  - Revoked account: active Slack sync is blocked before ingestion.
  - Missing permission: selecting a channel outside the allowed scope fails with a clear error.
  - Duplicate thread: repeated thread payload is deduped by the shared Composio ingestion path.
  - Review/query path: a synced Slack artifact can be committed as source-backed memory, approved/merged, and queried with citations.

## Integration/build checks

- `npm test -- tests/slack-composio-ingestion.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
