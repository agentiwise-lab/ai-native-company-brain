# AGE-65 Add Composio config, sessions, connected accounts, and toolkit discovery

Linear: https://linear.app/agentiwise/issue/AGE-65/add-composio-config-sessions-connected-accounts-and-toolkit-discovery

## What to build

Add the Composio integration control plane inside setup and admin. Operators should configure Composio credentials, create or select auth configs, connect accounts, create sessions for users/agents/workers, discover available toolkits/actions, and map those capabilities into internal source connectors and registry tool definitions.

## Acceptance criteria

- [ ] Admin can enter and validate Composio project/API configuration.
- [ ] Admin can initiate, test, refresh, revoke, and reauthorize connected accounts.
- [ ] The system creates/reuses Composio sessions for interactive agents, connector workers, and cron jobs.
- [ ] Discovered Composio toolkits/actions are stored as internal registry candidates with owner, tier, permissions, and audit policy.
- [ ] Tests cover missing credentials, revoked accounts, unavailable toolkits, and session reuse.

## Blocked by

- AGE-63
- AGE-64
