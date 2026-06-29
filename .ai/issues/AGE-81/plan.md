# Implementation Plan

## Vertical slice

Add a canonical package import service with file-backed state, validation, draft changesets, route, and dashboard preview. This is intentionally separate from publication; AGE-82 owns gated publishing.

## Design

- Add `lib/registry-import.ts`.
- Validate canonical registry item manifests for all registry kinds.
- For skill packages, require markdown, evals, examples, changelog, and rollback target when updating an existing version line.
- Validate dependencies and required tools against an existing registry snapshot.
- Detect duplicate `kind/slug/version` imports.
- Store imported packages as drafts and create changeset-shaped review records.
- Generate diff/dependency/permission/adapter preview metadata for UI and agents.
- Add `POST /api/v1/registry/import` and `GET /api/v1/registry/imports`.

## Non-goals

- No sandbox/eval/security scan execution; AGE-82 owns checks.
- No package publication or install bundle generation; AGE-84/85 own exports and install.
