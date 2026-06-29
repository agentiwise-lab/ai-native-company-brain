# Implementation Plan

## Goal

Create the connector operations layer for health summaries, checkpoint inspection, replay, revoked account enforcement, and failure visibility across all Composio-backed connector workers.

## Technical approach

1. Add `lib/connector-ops.ts`:
   - merge Composio control-plane state and ingestion state into a health dashboard model
   - compute lag, latest checkpoint, latest run, recent errors, and action guidance
   - replay an existing artifact through the shared ingestion pipeline
   - block replay/tool execution when connected account is revoked
2. Public API:
   - `GET /api/v1/connectors/health`
   - `POST /api/v1/connectors/replay`
3. UI:
   - add connector operations panel to the dashboard with health, failures, checkpoints, and replay targets

## Rollout

- Replay is idempotent because it reuses AGE-69 checksum/dedupe semantics.
- Failure details retain metadata and messages but avoid secrets/raw credentials.
