# AGE-70 - Composio-backed Slack ingestion

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-70/composio-backed-slack-ingestion
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Deliver the first real communication-source integration through Composio. An admin should connect Slack, select allowed workspace/channel scopes, backfill a date range, sync new conversations, inspect artifacts, and query Slack-derived memory after review.

## Acceptance criteria

- Slack connected account can be configured, tested, revoked, and reauthorized from the connector UI.
- Selected channels/threads/files sync into source artifacts through the shared Composio normalization path.
- Sync preserves useful provenance, authorship, timestamps, channel context, and available ACL/scope metadata.
- Synced Slack artifacts can be committed/reviewed and queried with citations.
- Tests cover backfill, incremental sync, revoked account, missing permission, and duplicate thread handling.

## Blocked by

- AGE-69 - Normalize Composio outputs into source artifacts
