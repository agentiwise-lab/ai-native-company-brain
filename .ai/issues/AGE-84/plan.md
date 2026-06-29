# Implementation Plan

## Slice

Create a governed agent export pipeline that turns one published canonical registry package plus its registry dependency closure into downloadable target bundles for Codex, Claude Code, OpenCode, and generic MCP agents.

## Design

- Extend adapter generation so all target bundles carry canonical metadata: package id, version, rollback target, required tools, dependencies, permissions, MCP endpoint, examples, and changelog.
- Add a permission mapping validator that fails unknown permission namespaces before a package can publish.
- Add dependency closure validation that rejects missing non-atom dependencies and missing required tools.
- Add a file-backed export service that generates package-specific bundle records, persists generation failures, and returns download/install URLs.
- Add API routes:
  - `POST /api/v1/registry/exports` to generate bundles for a package.
  - `GET /api/v1/registry/exports` to list generated bundles.
  - `GET /api/v1/registry/exports/[id]/download` to download a JSON bundle payload.
- Wire registry publication checks to the same adapter validation so export failures block publication.
- Surface the latest export bundles and failures on the dashboard compatibility panel.

## Boundaries

- Keep v1 download format as JSON with files and metadata; zip packaging can be a later install-flow issue.
- Do not add live marketplace distribution here; AGE-85/AGE-98 cover install/download marketplace depth.
