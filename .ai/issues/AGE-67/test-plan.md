# Test Plan

## API tests

- `tests/changeset-review-api.test.ts`
  - Approving then merging a source-backed candidate approves the atom, marks the changeset merged, and writes review + merge events.
  - Rejecting a candidate marks the atom rejected and the changeset rolled back.
  - Requesting changes can edit candidate title/body and blocks the changeset.
  - Merging a candidate with failed required checks returns a blocked response and does not approve the atom.
  - Atom lineage includes review and merge events after a successful merge.

## Integration/build checks

- `npm test -- tests/changeset-review-api.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
