# Implementation Plan

## Slice

Create the package distribution workflow that sits on top of generated agent export bundles. It should let authorized users browse installable published packages, generate target-specific install/download snippets, pin versions, and roll back a package while flagging dependents.

## Design

- Add a package distribution service with a file-backed state for install pins, rollback records, impacted dependents, and audit events.
- Catalog published packages visible to a principal through registry discovery policy and install scopes.
- Derive catalog metadata from canonical registry items: quality score, changelog, compatible agent targets, rollback target, and install options.
- Generate install bundles by calling the AGE-84 agent export service for a pinned version and target.
- Store a pin record containing principal, package, target, version, bundle id, and copyable install/config snippet.
- Rollback by finding the prior package version, creating an approved rollback changeset, emitting a `rollback` audit event, generating replacement exports, and recording dependent package impact.
- Add API routes:
  - `GET /api/v1/registry/distribution`
  - `POST /api/v1/registry/distribution/install`
  - `POST /api/v1/registry/distribution/rollback`
- Add a dashboard panel showing published packages, install options, pins, rollback records, and impacted dependents.

## Boundaries

- The v1 install format remains copyable commands/config snippets plus JSON bundle downloads.
- Actual local agent file installation remains a future CLI/marketplace concern.
