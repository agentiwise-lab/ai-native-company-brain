# Implementation Plan

## Goal

Create a Composio-backed engineering/product ingestion worker for GitHub and Linear that emits governed source artifacts into the shared normalization pipeline.

## Technical approach

1. Add `lib/work-composio-ingestion.ts`:
   - client abstraction for GitHub and Linear pages
   - configurable Composio REST tool execution defaults
   - source scope validation for selected repos/projects/teams
2. Normalize GitHub artifacts:
   - PRs, issues, discussions, comments, repo context, status, labels, authors, timestamps
   - deleted/renamed metadata
   - dedupe duplicate comments by comment id
3. Normalize Linear artifacts:
   - issue/project metadata, comments, status, labels, team/project context, authors, timestamps
   - deleted/renamed metadata
4. Pagination/checkpoints:
   - fetch pages until no cursor remains
   - reuse AGE-69 checkpoints for incremental sync
5. Public surface/UI:
   - `POST /api/v1/ingestion/work/sync`
   - `GET /api/v1/ingestion/work/sync`
   - connector console for GitHub/Linear account lifecycle and scoped sync

## Rollout

- Keep exact Composio tool slugs configurable per deployment.
- Store no raw tokens; only connected account IDs, selected source metadata, and artifacts are persisted.
