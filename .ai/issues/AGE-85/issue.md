# AGE-85 Package Install/Download Flow With Rollback

Linear: https://linear.app/agentiwise/issue/AGE-85/package-installdownload-flow-with-rollback

## What To Build

Build the distribution path for published registry packages. Users should browse published packages, download or install agent-specific bundles, pin versions, view changelogs, and rollback to a known good version when evals, usage, or reviewers detect problems.

## Acceptance Criteria

- Registry UI lists published package versions with status, quality score, changelog, compatible agents, and install options.
- Users can download or copy install/config snippets for supported agent surfaces.
- Rollback creates an audited changeset and restores prior published package metadata and exports.
- Dependent packages are flagged when rollback affects them.
- Tests cover install bundle generation, pinned version, rollback, dependency impact, and unauthorized install visibility.

## Blocked By

- AGE-84
