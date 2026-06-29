# AGE-66 Make brain query and commit real through UI/API

Linear: https://linear.app/agentiwise/issue/AGE-66/make-brain-query-and-commit-real-through-uiapi

## What to build

Turn brain query and commit from demo routes into a working end-to-end user path. An authorized user should query governed memory, see citations, commit a candidate atom from the UI/API, and see that candidate appear in the review queue with persisted lineage and events.

## Acceptance criteria

- [ ] Brain query uses persisted atoms/artifacts and returns citations, tier, freshness, and confidence metadata.
- [ ] Brain commit creates a candidate atom, source/link metadata, changeset, and audit event.
- [ ] Operator console actions call real APIs and show loading, success, empty, and error states.
- [ ] API and UI enforce tenant/user context.
- [ ] Tests cover successful query, empty query, forbidden query, and candidate commit.

## Blocked by

- AGE-64
