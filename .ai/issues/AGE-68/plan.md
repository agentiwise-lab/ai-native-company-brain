# Implementation Plan

## Goal

Make ACL and policy decisions explicit, reusable, and auditable across retrieval, review/merge, registry discovery, and Composio-backed tool access.

## Technical approach

1. Extend policy helpers:
   - review permission by changeset tier/owner/reviewer role
   - registry/tool invocation policy
   - sensitivity helpers for restrictive derived-memory handling
2. Retrieval:
   - keep filtering citations through `canReadAtom`
   - add deny events for atoms filtered by policy
   - persist/return allow and deny policy decisions with reason metadata
3. Review/merge:
   - block reviewers who cannot access the changeset tier
   - block review/merge attempts when a reviewer tries to override protected-tier ACL
4. Registry and Composio:
   - use registry/tool policy helpers for executable capability visibility
   - keep Composio-discovered tools staged as review candidates and block unsafe execution policy
5. Tests:
   - forbidden protected memory is excluded and audited
   - allowed memory still returns citations and allow event
   - non-exec reviewer cannot review exec-protected changeset
   - employee cannot invoke write-capable connector/tool capability

## Rollout

- Keep default seed/demo UX working.
- Later issues can deepen source-specific ACL inheritance once ingestion creates richer source ACL records.
