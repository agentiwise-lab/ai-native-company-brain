# AGE-79 Detect Duplicates And Contradictions With Review Workflow

Linear: https://linear.app/agentiwise/issue/AGE-79/detect-duplicates-and-contradictions-with-review-workflow

## What to build

Add duplicate and contradiction detection to the memory compiler and review queue. When new candidate atoms overlap or conflict with existing memory, the system should open a reviewable conflict/duplicate changeset that lets reviewers merge, supersede, demote, reject, or request source evidence.

## Acceptance criteria

- [ ] Extraction detects likely duplicates and contradictions against reviewed and pending atoms.
- [ ] Conflict changesets show compared claims, sources, tiers, freshness, owners, and recommended resolution.
- [ ] Reviewers can merge duplicates, supersede stale atoms, reject bad candidates, or request more evidence.
- [ ] Resolution updates lineage and emits audit events.
- [ ] Tests cover duplicate merge, contradiction, stale supersession, false positive dismissal, and ACL-sensitive conflict visibility.

## Blocked by

- AGE-77
- AGE-67
