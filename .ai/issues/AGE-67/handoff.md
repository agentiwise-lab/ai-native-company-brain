# Handoff For AGE-67

## Checkpoint 2026-06-29

- Branch: `harshit/all-linear-issues-buildout`
- Current phase: implemented and locally verified.
- Added repository review/merge methods for seed and Postgres modes.
- Candidate source evidence checks now pass when source IDs or source links are present.
- Added changeset list, review, and merge API routes.
- Review supports approve, reject, request changes, and candidate title/body edits.
- Merge blocks failed required checks and writes merge audit events; lineage includes review and merge events.
- Verification passed: `npm test -- tests/changeset-review-api.test.ts`, `npm run typecheck`, `npm test`, `npm run ci`.
