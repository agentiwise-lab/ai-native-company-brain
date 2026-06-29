# Implementation Plan

## Vertical slice

Add a self-contained memory quality loop that scores atoms from current signals, opens review queue items for stale/low-quality memory, records reviewer actions, and makes hybrid retrieval quality-aware.

## Design

- Add `lib/memory-quality-loop.ts` with file-backed state.
- Score signals: source evidence strength, freshness, source health, usage/retrieval success, corrections, conflict history, review rigor, and atom confidence/status.
- Queue actions: refresh, demote, supersede, retire.
- Reviewer resolution records audit events and lineage-style outcome metadata.
- Extend hybrid retrieval to accept optional `QualityScore[]` and use quality score/reviewer trust/conflict risk as ranking factors.
- Add status/run/resolve routes and dashboard visibility.

## Non-goals

- No background scheduler yet; AGE-88 owns the weekly agent.
- No automatic destructive mutation; reviewer resolution records intended action and audit evidence.
