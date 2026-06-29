# AGE-87 Cron Outputs To Slack, Email, Webhook, And Dashboard Via Policy Gates

Linear: https://linear.app/agentiwise/issue/AGE-87/cron-outputs-to-slack-email-webhook-and-dashboard-via-policy-gates

## What To Build

Implement cron output destinations with approval gates. Scheduled agent workflows should deliver results to Slack, email, webhook, and dashboard destinations only after policy checks, sensitive-output approvals, budget checks, and audit logging.

## Acceptance Criteria

- Cron definitions can configure Slack, email, webhook, and dashboard output destinations.
- Sensitive outputs pause for approval before delivery and expose reviewer context.
- Delivery uses allowed Composio sessions/actions where applicable and never bypasses policy.
- Runs show output status, approvals, failures, retries, and delivered destination links.
- Tests cover approved delivery, blocked delivery, failed webhook, revoked account, and notification noise suppression.

## Blocked By

- AGE-86
- AGE-70
- AGE-71
- AGE-73
