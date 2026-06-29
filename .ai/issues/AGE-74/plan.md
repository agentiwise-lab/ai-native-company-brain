# Implementation Plan

## Goal

Make `/api/mcp` an authenticated MCP-compatible agent surface that respects principal context, ACLs, registry permissions, and Composio session/account state.

## Technical approach

1. Add MCP auth context:
   - Bearer/API key format tied to tenant and principal
   - `x-tenant-id` and `x-principal-id` fallback for local smoke tests
2. Scope MCP tools:
   - list only built-in brain tools and registry-backed Composio tools discoverable by the principal
   - gate tool calls with the same policy helpers as HTTP APIs
3. Extend `tools/call`:
   - brain query, commit, registry search, audit trace
   - `tool.invoke` for approved Composio-backed tools through an active session/connected account
4. Add smoke client:
   - local script exercises initialize, tools/list, brain query, denied tool, and revoked account denial

## Rollout

- Default local API key should be deterministic for self-host smoke tests and configurable by env.
- Do not expose secrets or Composio API keys through MCP responses.
