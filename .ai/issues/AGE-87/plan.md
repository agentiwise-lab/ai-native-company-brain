# Implementation Plan

## Slice

Add a governed cron output delivery layer that consumes scheduler run output and sends it to configured destinations only through policy, approval, and audit gates.

## Design

- Add a file-backed output delivery state containing deliveries, approval holds, dashboard output records, and audit events.
- Support destination types: Slack, email, webhook, and dashboard.
- Require destination tools to be included in the cron job's allowed tool list before delivery.
- Use the AGE-83 tool invocation gateway for Composio-backed Slack/email delivery.
- Use an injected webhook client for webhook delivery with failure capture and audit.
- Store dashboard output locally with a stable dashboard link.
- Pause sensitive output or destinations with approval gates and expose reviewer context.
- Suppress noisy duplicate notifications by destination/dedupe key inside a quiet window.
- Add API routes to deliver cron output and inspect delivery state.
- Add dashboard visibility for delivered, blocked, failed, approval-paused, and suppressed outputs.

## Boundaries

- This slice handles delivery policy and records; richer approval decision UX can build on the approval records later.
- Webhook delivery is injectable/testable and stores metadata, not raw secrets.
