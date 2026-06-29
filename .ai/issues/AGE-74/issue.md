# AGE-74 - Authenticated MCP MVP bridging brain tools and Composio sessions

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-74/authenticated-mcp-mvp-bridging-brain-tools-and-composio-sessions
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Turn the MCP endpoint into a real authenticated agent surface. External MCP-compatible clients should initialize, list allowed brain and registry tools, call brain query/commit/audit tools, and invoke Composio-backed capabilities through sessions constrained by internal registry and policy decisions.

## Acceptance criteria

- MCP clients authenticate with API key or OAuth-style credentials tied to tenant and principal context.
- `tools/list` only returns brain, registry, and Composio-backed tools allowed for that principal.
- `tools/call` supports brain query, brain commit, registry search, audit trace, and approved Composio-backed invocation.
- A local MCP smoke-test client proves initialization, list, call, and denial behavior.
- Tests cover unauthorized client, forbidden tool, revoked connected account, and successful cited query.

## Blocked by

- AGE-65 - Add Composio config, sessions, connected accounts, and toolkit discovery
- AGE-66 - Make brain query and commit real through UI/API
- AGE-68 - Enforce ACL inheritance in retrieval, review, and Composio tool access
