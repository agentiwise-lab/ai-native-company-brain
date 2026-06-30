# AGE-90 Connector Failure Triage And Offboarding Export Assistants

Linear: https://linear.app/agentiwise/issue/AGE-90/connector-failure-triage-and-offboarding-export-assistants

## What to build

Create maintenance assistants for connector failures and employee offboarding. The system should diagnose broken Composio connections/checkpoints, open actionable repair tasks, and support exporting/revoking an individual's brain, connected-account mappings, and access footprint during offboarding.

## Acceptance criteria

- Connector triage agent detects failed syncs, revoked accounts, expired auth, lag spikes, missing scopes, and repeated transform failures.
- Agent opens repair tasks or changesets with connector, account, checkpoint, failure evidence, and recommended action.
- Offboarding assistant exports individual-owned memory/artifacts allowed by policy and revokes or remaps connected-account access.
- All export and revocation actions are audited and visible in the compliance UI.
- Tests cover expired auth, lag alert, repeated failure, offboarding export, access revocation, and denied export.

## Blocked by

- AGE-75: Done
- AGE-86: Done
