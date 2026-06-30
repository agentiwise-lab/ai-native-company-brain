# Implementation Plan

## Slice

Add connector maintenance and offboarding assistants that are visible in the admin/compliance UI and callable through API routes.

## Design

- Add a file-backed connector maintenance state containing triage runs, repair tasks, offboarding exports, and audit events.
- Reuse `connectorOps.health()` for connector status, lag, checkpoint, and recent failure context.
- Detect expired auth, revoked accounts, failed syncs, lag spikes, missing scopes, and repeated transform failures.
- Open idempotent repair tasks with connector/account/checkpoint/failure evidence and recommended action.
- Add an offboarding flow that exports owned atoms/artifacts permitted by policy, revokes or records remapped connected accounts, and audits every export/revocation decision.
- Add API routes for triage, status, and offboarding execution.
- Add a dashboard/compliance panel for repair tasks, offboarding exports, and audit events.

## Boundaries

- This slice opens repair tasks and performs account revocation/remap bookkeeping. It does not build a full case-management queue outside the app state.
