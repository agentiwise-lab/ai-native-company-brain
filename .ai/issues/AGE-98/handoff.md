# Handoff

AGE-98 is in progress on `harshit/all-linear-issues-buildout`.

Current direction: add a marketplace service and API/UI surfaces that sit above existing registry import, distribution, and cloud/self-host compatibility primitives.

## Implemented

- `lib/marketplace.ts` provides file-backed marketplace state for reviews, installs, rollbacks, and audit events.
- Private listings are derived from published local registry packages; public listings come from canonical marketplace package manifests.
- Listings expose owner, version, compatibility, eval results, security status, install count, changelog, trust, provenance, dependencies, and permissions.
- Installs open local draft registry changesets and can stage missing public dependency changesets.
- Unsafe packages are blocked before install creation and emit deny audit events.
- Rollback opens an approved audited rollback changeset for marketplace install records.
- API routes exist under `/api/v1/registry/marketplace`.
- The dashboard now shows governed marketplace installs alongside compatibility and distribution.

## Verification

- `npm test -- tests/marketplace.test.ts` passed: 7 tests.
- `npm run ci` passed: 41 test files, 223 tests, Next build passed.
