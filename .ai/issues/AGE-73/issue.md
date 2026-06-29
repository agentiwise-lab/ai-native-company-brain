# AGE-73 - Composio-backed Notion plus generic webhook ingestion

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-73/composio-backed-notion-plus-generic-webhook-ingestion
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Deliver the flexible knowledge-source path. Admins should connect Notion through Composio and configure generic webhook ingestion for tools not yet first-class. Both paths should emit normalized source artifacts that enter the same review, retrieval, and audit pipeline as the primary integrations.

## Acceptance criteria

- Notion connected account can sync selected pages, databases, and comments into source artifacts.
- Generic webhook ingestion accepts signed payloads, source identifiers, provenance, ACL hints, and raw content.
- Admin can inspect, replay, disable, and revoke Notion/webhook sources.
- Reviewed Notion/webhook artifacts are queryable with citations.
- Tests cover invalid signatures, malformed payloads, duplicate webhooks, revoked Notion accounts, and unsupported Notion blocks.

## Blocked by

- AGE-69 - Normalize Composio outputs into source artifacts
