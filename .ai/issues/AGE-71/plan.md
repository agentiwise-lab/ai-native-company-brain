# Implementation Plan

## Goal

Create the Google ingestion worker that syncs Drive documents and Gmail threads through Composio into governed source artifacts using the shared normalization pipeline.

## Technical approach

1. Add `lib/google-composio-ingestion.ts`:
   - Google client abstraction with Drive and Gmail fetch methods
   - default Composio REST executors with configurable tool slugs
   - selected source validation for scopes, labels, folders, and ACL metadata
2. Normalize Drive artifacts:
   - source object id `google-drive:<account>:<documentId>`
   - preserve URL, title, MIME type, authors/owners, modified date, folder/scope metadata
   - trim large content into a bounded normalized text body while retaining raw payload
3. Normalize Gmail artifacts:
   - source object id `gmail:<account>:<threadId>`
   - preserve subject, senders, recipients, timestamps, labels, attachments/unsupported formats, and thread structure
4. Dedupe/checkpoint:
   - reuse the AGE-69 ingestion pipeline for duplicate/update behavior
   - cursor falls back to modified date/thread timestamp
5. Public surface/UI:
   - `POST /api/v1/ingestion/google/sync`
   - `GET /api/v1/ingestion/google/sync`
   - Google connector console for account lifecycle and scoped sync

## Rollout

- Keep Composio tool slugs configurable per deployment.
- No raw OAuth secrets are stored; only connected account IDs, scope metadata, and source artifacts are persisted.
