# Implementation Plan

## Slice

Add a file-backed enterprise identity/org-sync service with SCIM replay safety, SAML config, policy decisions, API routes, dashboard visibility, and a tool-invocation policy hook.

## Design

- Add `identity-org-sync` state for SAML/SCIM config, users, groups, processed SCIM events, reviewer mappings, access revocations, and audit events.
- Sync SCIM user/group events idempotently and derive principals from group mappings.
- Map groups to teams, brain tiers, registry scopes, roles, and reviewer ownership.
- Deactivate users by revoking UI/API/MCP access, clearing active scopes, revoking visible Composio session eligibility, and remapping reviewer duties to another eligible reviewer.
- Add optional identity policy hook to the tool invocation gateway.
- Add API routes for configure, SCIM sync, and status.
- Add dashboard compliance visibility for SSO/SCIM status, active/deactivated users, groups, revocations, and audit events.

## Boundaries

- This slice stores SAML metadata/config status and SCIM-derived org graph. It does not implement a live SAML IdP redirect handler.
