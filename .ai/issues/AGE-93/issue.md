# AGE-93 SAML/SCIM Org Sync And Access Revocation

Linear: https://linear.app/agentiwise/issue/AGE-93/samlscim-org-sync-and-access-revocation

## What to build

Add enterprise identity and org sync. Admins should configure SAML and SCIM, sync users/groups/teams into the org graph, map them to brain tiers and registry policies, and automatically revoke access, Composio session/tool visibility, and connected-account use when users are deactivated.

## Acceptance criteria

- Admin can configure SAML login and SCIM provisioning for users, groups, and deactivation.
- Synced org graph drives brain tier access, reviewer assignment, registry visibility, and Composio session/tool policy.
- Deactivated users lose UI/API/MCP access and cannot trigger Composio-backed tool execution.
- Access changes emit audit events and appear in compliance views.
- Tests cover user create/update/deactivate, group changes, reviewer remap, stale session denial, and SCIM replay.

## Blocked by

- AGE-63: Done
- AGE-68: Done
