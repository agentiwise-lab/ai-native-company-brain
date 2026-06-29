# Implementation Plan

## Goal

Create the first concrete connector worker: Slack through Composio into governed source artifacts, with selected channel scope, backfill/incremental sync, duplicate handling, provenance/ACL metadata, UI inspection, and review/query continuity.

## Technical approach

1. Add `lib/slack-composio-ingestion.ts`:
   - adapter accepts a Composio executor/client abstraction and the shared ingestion pipeline
   - validates active connected account and selected channel scopes
   - supports `backfill` and `incremental` sync modes
   - maps Slack channels, threads, messages, files, authors, timestamps, and permalinks into Composio ingestion inputs
2. Source identity and dedupe:
   - source object id: `slack:<workspace>:<channel>:<threadTs>`
   - thread replies/files are folded into one source artifact per thread
   - duplicate thread checksum is handled by AGE-69 pipeline
   - checkpoint cursor tracks last synced Slack timestamp/cursor
3. API surface:
   - `POST /api/v1/ingestion/slack/sync` runs a Slack sync request through the worker
   - `GET /api/v1/ingestion/slack/sync` returns current Slack artifact/run summary
4. Operator UI:
   - add Slack ingestion controls/summary to the connections area
   - show channels, mode, latest run, artifacts, and last checkpoint
5. Review/query continuity:
   - artifacts include source ids/provenance that can be passed to `brain.commit`
   - tests prove a Slack artifact can become a source-backed atom and be queried after review/merge

## Rollout

- Keep tool/action names configurable so deployments can map to exact Composio Slack actions.
- Use no raw Slack secrets; only connected account IDs, channel scopes, and source metadata are stored.
