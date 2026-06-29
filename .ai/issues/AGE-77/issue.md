# AGE-77 Extract Candidate Atoms And Assign Owners Automatically

Linear: https://linear.app/agentiwise/issue/AGE-77/extract-candidate-atoms-and-assign-owners-automatically

## What to build

Build the extraction worker that proposes source-backed knowledge atoms from processed chunks. The worker should identify decisions, procedures, facts, lessons, and policies, link them to sources/entities/projects, assign likely owners/reviewers, and open reviewable candidate changesets.

## Acceptance criteria

- [ ] Processed artifacts can produce candidate atoms with type, summary, body, confidence, source evidence, and target tier suggestion.
- [ ] Owner/reviewer assignment uses source context, domain rules, and fallback defaults.
- [ ] Candidate extraction opens changesets instead of directly publishing memory.
- [ ] Reviewer can inspect source snippets and edit proposed atom content before merge.
- [ ] Tests cover extraction quality fixtures, no-op artifacts, owner fallback, low-confidence candidates, and ACL propagation.

## Blocked by

- AGE-76
