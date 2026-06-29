# Test Plan

- `tests/package-distribution.test.ts`
  - Catalog lists only packages visible to the principal and includes quality score, changelog, compatible agents, rollback target, and install options.
  - Installing a Codex/OpenCode bundle generates a download bundle and stores a pinned version record.
  - Rollback creates an audited changeset, emits a rollback event, restores the target version metadata, and regenerates exports.
  - Rollback flags dependent packages that reference the rolled-back package.
  - Unauthorized principals cannot see or install packages outside their tier/scope.
  - API routes cover catalog, install, and rollback behavior.

## Required Verification

- `npm test -- tests/package-distribution.test.ts`
- `npm test`
- `npm run build`
