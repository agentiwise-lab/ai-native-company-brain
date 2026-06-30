# Test Plan

- `tests/compliance-workflows.test.ts`
  - Configures retention by source/tier/sensitivity and deletes expired matching atoms.
  - Active legal hold blocks retention deletion and emits audit events.
  - Exports individual-owned memory with lineage, sources, and policy context.
  - Builds answer audit packs tracing answer to citations, sources, reviewers, policies, tools, cron/session events.
  - Denies forbidden organization export for a principal without audit authority.
  - API routes cover retention configure/run, legal hold, export, audit pack, and status.

## Required Verification

- `npm test -- tests/compliance-workflows.test.ts`
- `npm run ci`
