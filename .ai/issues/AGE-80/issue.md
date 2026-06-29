# AGE-80 Quality Scores, Stale Review, And Demotion Loop

Linear: https://linear.app/agentiwise/issue/AGE-80/quality-scores-stale-review-and-demotion-loop

## What to build

Build the first memory quality system. Atoms should receive quality signals from source freshness, review rigor, usage, corrections, conflict history, and retrieval outcomes. Stale or low-quality atoms should enter a review/demotion loop instead of silently degrading the company brain.

## Acceptance criteria

- [ ] Atoms show quality score, freshness, source health, usage, corrections, and review history.
- [ ] Stale or low-quality atoms automatically appear in a review queue with recommended action.
- [ ] Reviewers can refresh, demote, supersede, or retire memory with audit events.
- [ ] Retrieval can use quality/freshness signals during ranking.
- [ ] Tests cover stale detection, demotion, score updates, correction feedback, and retrieval ranking impact.

## Blocked by

- AGE-78
- AGE-79
