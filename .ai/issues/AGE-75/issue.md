# AGE-75 - Connector health, checkpoints, replay, and revoke flow

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-75/connector-health-checkpoints-replay-and-revoke-flow
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Build the operations layer for Composio-backed connectors. Operators should see connector status, lag, checkpoints, recent sync runs, failures, retries, replay controls, account revocation status, and the impact of revocation on future sync/tool execution.

## Acceptance criteria

- Connector dashboard shows connected accounts, enabled sources, last checkpoint, lag, run status, and recent errors.
- Operator can replay a connector from a checkpoint or date range without duplicate artifacts.
- Revoking a Composio connected account stops future sync and tool execution and records an audit event.
- Failed sync runs expose retry/action guidance and retain raw failure context safely.
- Tests cover replay idempotency, revoked-account enforcement, checkpoint persistence, and failure visibility.

## Blocked by

- AGE-70 - Composio-backed Slack ingestion
- AGE-71 - Composio-backed Google Drive and Gmail ingestion
- AGE-72 - Composio-backed GitHub and Linear ingestion
- AGE-73 - Composio-backed Notion plus generic webhook ingestion
