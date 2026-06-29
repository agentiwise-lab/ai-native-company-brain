# Test Plan

- `tests/cron-output-delivery.test.ts`
  - Approved Slack delivery uses the governed tool invocation gateway and records a destination link.
  - Sensitive output pauses for approval and exposes reviewer context without delivery.
  - Delivery is blocked when destination tools are not in the cron job's allowed tools.
  - Webhook delivery failures are recorded with failed status and audit events.
  - Revoked/denied Composio account responses are blocked and audited.
  - Duplicate notifications are suppressed inside a quiet window.
  - API route covers delivery and status.

## Required Verification

- `npm test -- tests/cron-output-delivery.test.ts`
- `npm run ci`
