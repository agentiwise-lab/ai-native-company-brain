# AGE-94 Retention, legal hold, export, and answer audit packs

## What to build

Build the compliance workflows that make the brain auditable and controllable. Admins should configure retention and legal hold, export individual/org memory, trace an answer to atoms/sources/reviewers/policies/tools/cron runs, and produce audit packs for compliance review.

## Acceptance criteria

- [ ] Admin can configure retention windows, legal hold, and deletion behavior by source/tier/sensitivity.
- [ ] System can export individual and organization-owned memory with lineage and policy context.
- [ ] Answer audit pack traces response -> retrieved atoms -> sources -> reviewers -> policies -> tools -> cron/session.
- [ ] Legal hold prevents deletion and emits clear audit events.
- [ ] Tests cover retention deletion, legal hold block, individual export, answer trace export, and forbidden export.

## Blocked by

- AGE-93
- AGE-78
