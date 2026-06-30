# Test Plan

- `tests/meeting-crm-composio-ingestion.test.ts`
  - Zoom transcript ingestion preserves transcript provenance, participants, time range, recording metadata, and sensitivity.
  - Salesforce/HubSpot CRM pagination preserves account/deal context, owners, timestamps, and permission metadata.
  - Restricted customer memory is excluded from unauthorized retrieval and write-capable CRM tool access.
  - Revoked connected account blocks sync before client calls.
  - Native fallback gating blocks insufficient Composio ACL/delta/webhook coverage.
  - API routes cover meeting/CRM sync and status.

## Required Verification

- `npm test -- tests/meeting-crm-composio-ingestion.test.ts`
- `npm run ci`
