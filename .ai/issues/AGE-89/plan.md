# Implementation Plan

## Slice

Add a registry maintenance agent that scans package drift signals and opens concrete registry changesets/review tasks for affected packages.

## Design

- Add file-backed state for scans, findings, changesets, approvals, and audit events.
- Analyze dependency changes, policy atom changes, Composio action removals, eval scores, usage drops, deprecated tools, rollback risk, and adapter validation failures.
- Compute dependent packages by dependency/required-tool references.
- Open one registry changeset per affected package/action/evidence key.
- Pause risky findings when owner/reviewer approval is required.
- Prevent duplicate open review tasks for the same package/action/evidence key.
- Add API routes to run scans and inspect status.
- Add dashboard visibility for findings, changesets, approvals, and duplicate suppression.

## Boundaries

- The agent opens review tasks and changesets; it does not auto-promote or auto-rollback.
