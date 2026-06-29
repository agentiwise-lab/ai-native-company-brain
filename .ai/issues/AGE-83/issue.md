# AGE-83 Invoke Tools Through Internal Policy Plus Composio Execution

Linear: https://linear.app/agentiwise/issue/AGE-83/invoke-tools-through-internal-policy-plus-composio-execution

## What to build

Create the governed tool invocation gateway. Agents, UI actions, and cron jobs should invoke approved tools through internal policy checks first, then execute allowed Composio-backed actions using the right session/connected account, with secrets protected and every invocation auditable.

## Acceptance criteria

- [ ] Tool invocation checks tenant, principal, tier, package version, allowed scopes, rate limits, budget, and approval gates before execution.
- [ ] Allowed Composio-backed actions run through the correct session/connected account and store sanitized request/response metadata.
- [ ] Denied, failed, and successful invocations emit audit events.
- [ ] Secrets and raw sensitive payloads are not exposed in UI, logs, or agent responses.
- [ ] Tests cover allowed action, forbidden action, revoked account, rate limit, approval-required action, and secret redaction.

## Blocked by

- AGE-65
- AGE-68
- AGE-82
