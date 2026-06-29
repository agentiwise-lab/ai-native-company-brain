# AGE-76 - Parse, chunk, classify, and embed source artifacts

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-76/parse-chunk-classify-and-embed-source-artifacts
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Build the artifact processing pipeline that turns normalized source artifacts into searchable, classified chunks. The pipeline should parse source-specific structure, chunk content, classify sensitivity and prompt-injection risk, generate embeddings, index full text, and expose processing status in the UI.

## Acceptance criteria

- Source artifacts move through parse, chunk, classify, embed, and index states with retryable failures.
- Chunks preserve source offsets, provenance, ACL/sensitivity metadata, and artifact lineage.
- Full-text and vector search indexes are populated for processed artifacts.
- Operator console shows processing status and failure reasons per artifact.
- Tests cover short/long artifacts, unsupported format, sensitive-data classification, embedding failure, and reprocessing.

## Blocked by

- AGE-69 - Normalize Composio outputs into source artifacts
