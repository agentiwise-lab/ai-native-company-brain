# Implementation Plan

## Vertical slice

Add a reviewable conflict workflow that can run after candidate extraction. It should compare candidate atoms with existing reviewed/pending atoms, open conflict records with changeset-shaped review metadata, and record reviewer resolutions with audit/lineage events.

## Design

- Add `lib/memory-conflicts.ts` with deterministic duplicate/contradiction/stale-supersession detection.
- Inputs: candidate atoms, existing atoms, reviewer principal, optional owner/reviewer defaults.
- Enforce ACL before exposing compared atoms. Hidden restricted matches are counted but not shown as reviewable conflicts to unauthorized reviewers.
- Each conflict stores compared claim snapshots, source ids, tiers, freshness, owners, recommendation, checks, and a `Changeset` record.
- Resolution actions: merge duplicate, supersede existing, reject candidate, request evidence, dismiss false positive.
- Resolution emits audit events and lineage effects that downstream persistence can apply.
- Add status/detect/resolve routes and dashboard visibility.

## Non-goals

- No LLM adjudication; recommendations are deterministic.
- No destructive automatic atom mutation in this slice.
- No broad quality score loop; AGE-80 owns ongoing scoring/demotion.
