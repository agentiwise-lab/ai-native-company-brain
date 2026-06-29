# AGE-68 Enforce ACL inheritance in retrieval, review, and Composio tool access

Linear: https://linear.app/agentiwise/issue/AGE-68/enforce-acl-inheritance-in-retrieval-review-and-composio-tool-access

## What to build

Implement the policy layer that prevents forbidden memory, sources, registry items, and Composio-backed tools from being visible or executable. Derived memory must inherit the most restrictive source permissions, and every policy allow/deny decision must be auditable.

## Acceptance criteria

- [ ] Retrieval excludes atoms and source artifacts outside the requesting principal's access.
- [ ] Changeset review and tier promotion fail when source ACLs conflict with target tier visibility.
- [ ] Registry and Composio toolkit/action discovery only expose allowed capabilities.
- [ ] Denied access and allowed access both write policy decision events with enough context for audit.
- [ ] Tests cover forbidden memory, forbidden tool execution, allowed team memory, and reviewer override denial.

## Blocked by

- AGE-65
- AGE-67
