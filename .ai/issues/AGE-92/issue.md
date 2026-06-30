# AGE-92 Add Composio-First Zoom/Meet/Salesforce/HubSpot Connector Expansion

Linear: https://linear.app/agentiwise/issue/AGE-92/add-composio-first-zoommeetsalesforcehubspot-connector-expansion

## What to build

Expand into meetings and CRM sources using the same Composio-first model. Admins should connect Zoom, Google Meet-derived sources, Salesforce, and HubSpot where supported, sync transcripts/recording metadata/accounts/deals/notes into artifacts, and enforce stricter ACL/sensitivity handling for customer and revenue data.

## Acceptance criteria

- Meeting and CRM sources follow the same connect, test, revoke, checkpoint, health, and replay model.
- Meeting artifacts preserve transcript provenance, participants, time ranges, recording metadata, and sensitivity classification.
- CRM artifacts preserve account/deal context, owners, timestamps, and available permission metadata.
- Restricted CRM/meeting memory is excluded from unauthorized retrieval and agent tool access.
- Tests cover transcript ingestion, CRM pagination, restricted customer data, revoked account, and native fallback gating.

## Blocked by

- AGE-75: Done
- AGE-78: Done
