# Test Plan

- `tests/enterprise-composio-ingestion.test.ts`
  - Microsoft source sync preserves provenance, authorship, timestamps, structure, and ACL metadata.
  - Jira and Confluence sync paginate with checkpoint updates.
  - GitLab sync preserves comments.
  - Revoked account blocks sync before client calls.
  - Fallback gating blocks insufficient Composio coverage and documents native adapter requirements.
  - Reviewed enterprise-derived artifacts are queryable with citations through hybrid retrieval.
  - API routes cover enterprise sync and status.

## Required Verification

- `npm test -- tests/enterprise-composio-ingestion.test.ts`
- `npm run ci`
