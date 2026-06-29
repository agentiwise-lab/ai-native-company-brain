# Implementation Plan

## Vertical slice

Turn already-indexed artifact chunks into reviewable candidate memory atoms. The slice should be demoable from API and dashboard: process an artifact, run extraction, inspect candidate atoms and source snippets, then use the existing changeset review path to edit before merge.

## Design

- Add a candidate extraction module that reads `ArtifactProcessingState` chunks and writes an extraction run state.
- Classify candidate atoms with deterministic rules for decisions, procedures, policies, lessons, and claims.
- Preserve source evidence: artifact id, chunk id, offsets, provenance URL, excerpt, checksum, ACL, and sensitivity.
- Extend `CommitBrainInput` so extraction can pass atom type, owner, reviewers, ACL, confidence, tags, and source-backed changeset summary into the existing repository commit path.
- Use owner assignment rules from chunk/source context first, then domain rules, then a configured fallback owner/reviewer.
- Add API routes for extraction run and status.
- Add a dashboard panel showing latest extraction runs, candidate atoms, target tier suggestions, owner/reviewer assignments, and source excerpts.

## Non-goals

- No LLM dependency in v1 extraction; keep self-host setup deterministic and testable.
- No automatic merge or publication. All extracted atoms remain candidate changesets.
- No duplicate/contradiction resolution; AGE-79 owns that.
