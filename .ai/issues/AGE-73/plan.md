# Implementation Plan

## Goal

Create the flexible ingestion path for Notion through Composio and signed generic webhooks, both backed by the shared source artifact pipeline.

## Technical approach

1. Add `lib/flexible-composio-ingestion.ts`:
   - Notion Composio client abstraction and configurable REST executor
   - signed webhook ingestion with HMAC-SHA256 verification
   - source state for disable/revoke/replay summaries
2. Normalize Notion artifacts:
   - selected pages/databases/comments
   - preserve URL, author, workspace/database context, timestamps, comments, unsupported blocks
3. Normalize webhook artifacts:
   - validate signature, source id/type, provenance URL, ACL hints, raw content
   - emit `docs` source artifacts under `webhook:<sourceId>`
4. Public surface/UI:
   - `POST /api/v1/ingestion/flexible/notion/sync`
   - `POST /api/v1/ingestion/flexible/webhook`
   - `GET /api/v1/ingestion/flexible`
   - console for Notion account lifecycle, source disable/replay summaries, and webhook status

## Rollout

- Keep exact Notion Composio tool slug configurable.
- Webhook secret comes from request/config/env; do not store raw secrets.
