# Implementation Plan

## Goal

Create a generic Composio ingestion pipeline that normalizes tool/action results into governed source artifacts with dedupe, checkpointing, metadata, and audit events.

## Technical approach

1. Add `lib/composio-ingestion.ts`:
   - file-backed ingestion store at `data/composio-ingestion-state.json`
   - typed normalized artifacts, checkpoint records, sync runs, and audit events
   - `ingestComposioResult` worker method
2. Normalize artifacts:
   - canonical source artifact fields
   - raw JSON payload and normalized text
   - connector/source object identity
   - principal/account mapping
   - provenance URL
   - ACL and sensitivity metadata
   - deterministic checksum
3. Dedupe/checkpoint behavior:
   - same connector/source object/checksum => duplicate, no new artifact
   - same connector/source object/new checksum => update artifact
   - checkpoint stores cursor, timestamp, and last source object id
4. Add API routes:
   - `GET /api/v1/ingestion/composio/artifacts`
   - `POST /api/v1/ingestion/composio`
5. Add a compact dashboard inspection panel with artifact count, latest sync status, connector, sensitivity, and checkpoint.

## Rollout

- Later connector issues can call the same ingestion pipeline after Composio actions complete.
- Raw object storage is represented by stable object keys in this slice; object-store writes can be added behind the same record shape.
