# Implementation Plan

## Vertical slice

Upgrade `brain.query` without breaking existing API/MCP clients. Query responses should still return `citations`, `events`, and `retrievedRegistry`, while adding retrieval diagnostics that explain why each citation ranked.

## Design

- Add a pure hybrid retrieval ranker for `KnowledgeAtom` records.
- Inputs: query text, principal, candidate atoms, optional dependency edges, and optional requested tier.
- Ranking factors: lexical overlap, semantic/vector similarity, metadata/tag/source match, graph boost, tier authority, freshness, confidence, and status.
- Apply ACL checks before citations are selected; emit deny events for matched but unreadable atoms.
- Prefer higher-authority reviewed memory while still surfacing fresh lower-tier candidates when they materially match.
- Update seed and Postgres repositories to call the shared ranker.
- Extend `BrainQueryResult` with retrieval diagnostics used by agents and UI operators.

## Non-goals

- No external vector database dependency in this slice.
- No contradiction resolution; AGE-79 handles conflict review.
- No answer-generation LLM; answer synthesis remains deterministic and cited.
