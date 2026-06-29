# Implementation Plan

## Goal

Make brain query and brain commit a real operator workflow through the API and dashboard, backed by the repository boundary from AGE-64.

## Technical approach

1. Add request-context enforcement for tenant and principal:
   - Accept `x-tenant-id` and `x-principal-id` headers.
   - Allow body `principalId` for current local flows.
   - Reject tenant mismatch and unknown/forbidden principals.
2. Improve query behavior:
   - Empty query returns top accessible memories.
   - Non-empty query returns only actual matches.
   - Response citations expose tier, freshness, confidence, status, and tags from persisted atoms.
3. Improve commit behavior:
   - Accept source/link metadata (`sourceIds`, `sourceUri`, `sourceTitle`).
   - Create candidate atom, review changeset, and audit event in one repository mutation.
   - Return atom, changeset, and event to the API/UI.
4. Add a client-side operator workbench:
   - Query form calls `/api/v1/brain/query`.
   - Commit form calls `/api/v1/brain/commit`.
   - Show loading, success, empty, and error states.
   - Show citations with tier, freshness, confidence.
   - Show committed candidate and changeset status.
5. Keep seed mode and Postgres mode behavior aligned.

## Rollout

- Seed mode remains useful for local demo and tests.
- Postgres mode persists commits through the AGE-64 repository.
- Later AGE-67 review/merge can build directly on the candidate changesets created here.
