# AGE-91 Add Composio-First Microsoft/Jira/Confluence/GitLab Connector Expansion

Linear: https://linear.app/agentiwise/issue/AGE-91/add-composio-first-microsoftjiraconfluencegitlab-connector-expansion

## What to build

Expand beyond the MVP connector set using the same Composio-first pattern. Admins should connect Microsoft Teams/Outlook/SharePoint/OneDrive, Jira, Confluence, and GitLab where supported, sync selected sources into artifacts, and fall back to native adapters only when Composio lacks required ACL, delta, or webhook fidelity.

## Acceptance criteria

- Each supported app follows the same connect, test, revoke, backfill, checkpoint, health, and artifact inspection model.
- Synced artifacts preserve source provenance, authorship, timestamps, structure, and available ACL metadata.
- Native fallback requirements are documented per app when Composio coverage is insufficient.
- Reviewed artifacts are queryable through the hybrid retrieval path with citations.
- Tests cover at least one Microsoft source, Jira/Confluence pagination, GitLab comments, revoked account, and fallback gating.

## Blocked by

- AGE-75: Done
- AGE-78: Done
