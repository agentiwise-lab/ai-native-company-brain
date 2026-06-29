# Test Plan

## Tests

- `tests/work-composio-ingestion.test.ts`
  - GitHub pagination: selected repo pages sync into artifacts and preserve URL, author, status, labels, repo context, comments, and permissions.
  - Linear sync: project/issues/comments sync into ticket artifacts with team/project/status/labels.
  - Deleted/renamed source: artifact text and raw metadata preserve deleted/renamed state.
  - Missing permission: selected repo/project outside allowed scope fails before client calls.
  - Duplicate comments: duplicate comment ids are normalized once.
  - Revoked account: sync fails before client calls or artifact writes.
  - Duplicate sync: repeated payloads dedupe through the shared ingestion path.
  - Review/query path: synced GitHub/Linear artifact can be committed, approved, merged, and queried with citations.

## Integration/build checks

- `npm test -- tests/work-composio-ingestion.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
