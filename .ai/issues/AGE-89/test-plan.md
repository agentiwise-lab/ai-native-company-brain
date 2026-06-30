# Test Plan

- `tests/registry-maintenance-agent.test.ts`
  - Dependency change flags dependent packages and opens changesets.
  - Policy atom change flags packages that depend on that policy atom.
  - Composio action removal flags connector tools and dependent packages.
  - Deprecated tool status flags dependent packages for replacement.
  - Broken adapter validation opens a review task and pauses risky review when required.
  - Low usage and rollback risk create concrete review tasks.
  - Duplicate review prevention avoids reopening the same package/action finding.
  - Pending approval review prevention avoids reopening paused risky findings.
  - API route covers scan and status.

## Required Verification

- `npm test -- tests/registry-maintenance-agent.test.ts`
- `npm run ci`
