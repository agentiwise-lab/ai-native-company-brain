# Implementation Plan

## Goal

Create the artifact processing pipeline that turns normalized source artifacts into searchable, classified, embedded chunks with status/failure visibility.

## Technical approach

1. Add `lib/artifact-processing.ts`:
   - file-backed processing state
   - parse, chunk, classify, embed, and index stages
   - deterministic local embedding fallback
   - retryable failure records
2. Chunk model:
   - source offsets, artifact id, connector, provenance URL, ACL/sensitivity metadata, lineage checksum
3. Indexes:
   - full-text token index
   - vector index with embedding vectors
4. Public API/UI:
   - `GET /api/v1/artifact-processing/status`
   - `POST /api/v1/artifact-processing/process`
   - dashboard processing status panel

## Rollout

- Embedding client is injectable so self-host can use local embeddings and cloud can use managed embeddings later.
- Unsupported or failed artifacts remain visible and retryable.
