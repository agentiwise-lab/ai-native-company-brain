# AGE-67 Review and merge memory changesets end-to-end

Linear: https://linear.app/agentiwise/issue/AGE-67/review-and-merge-memory-changesets-end-to-end

## What to build

Implement the PR-style review loop for knowledge memory. A reviewer should open a changeset, inspect source evidence and diffs, approve/reject/request changes, edit candidate content, and merge to a target tier with atom state, lineage, and audit trail updated atomically.

## Acceptance criteria

- [ ] Review queue shows pending memory changesets with source evidence, target tier, owner, and checks.
- [ ] Reviewer can approve, reject, request changes, edit candidate content, and merge.
- [ ] Merge updates atom state/tier and writes immutable review and merge events in one transaction.
- [ ] Required checks block unsafe merges with clear reasons.
- [ ] Tests cover merge, reject, request changes, failed required check, and audit lineage.

## Blocked by

- AGE-64
- AGE-66
