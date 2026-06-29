# Implementation Plan

## Goal

Add the first complete memory PR loop: candidates can be reviewed, edited, approved, rejected, requested for changes, and merged with checks and audit lineage.

## Technical approach

1. Extend the repository contract with memory-review methods:
   - list changesets for the review queue
   - review a memory changeset with action `approve`, `reject`, or `request-changes`
   - merge an approved memory changeset
2. Keep seed and Postgres implementations aligned:
   - seed mode mutates in-memory arrays so local UI/API workflows are end-to-end
   - Postgres mode wraps atom/change/event updates in one transaction
3. Improve candidate creation checks:
   - source evidence passes when a source id or source link is present
   - unsafe candidates without evidence remain blocked from merge
4. Add API routes:
   - `GET /api/v1/changesets`
   - `PATCH /api/v1/changesets/{id}/review`
   - `POST /api/v1/changesets/{id}/merge`
5. Add tests through the public API:
   - successful approve + merge
   - reject
   - request changes with edited content
   - failed required check
   - lineage includes review and merge events

## Rollout

- The existing server-rendered review queue continues showing changesets and checks.
- A later UI pass can add inline buttons; this issue makes the API and repository behavior real and test-covered.
