# Implementation Plan

## Goal

Create a Composio-first control plane that lets the app validate credentials, manage connected accounts, reuse sessions for agents/workers/cron, discover toolkits/actions, and stage discovered actions as internal registry tool candidates.

## Technical approach

1. Add typed Composio domain models for configuration, auth configs, connected accounts, sessions, toolkit actions, registry candidates, and audit events.
2. Add a small REST client wrapper for Composio v3.1 using `x-api-key`, with resilient response normalization so tests can use fakes and production can call the hosted API.
3. Add a persistent control-plane store at `data/composio-state.json` by default, mirroring the existing setup store pattern. The store must not persist raw API keys.
4. Implement service methods:
   - configure and validate credentials
   - initiate/test/refresh/revoke/reauthorize connected accounts
   - create or reuse sessions by principal, purpose, toolkits, and connected accounts
   - discover toolkit actions and stage each as a `ToolDefinition` registry candidate
5. Add API routes under `/api/v1/composio/*` for config, connected accounts, sessions, and discovery.
6. Add a compact admin panel to the dashboard showing configuration, connected accounts, sessions, and discovered registry candidates.
7. Keep live Composio calls injectable and optional for tests; missing credentials must fail explicitly before network calls.

## External API reference notes

- Composio API base: `https://backend.composio.dev`
- Auth header: `x-api-key`
- Relevant concepts: auth configs, connected accounts, sessions/tool router, toolkits, and tools/actions.

## Rollout and compatibility

- Self-host dev works without a Composio key and shows an unconfigured state.
- Operators can set `COMPOSIO_API_KEY`, `COMPOSIO_PROJECT_ID`, and `COMPOSIO_BASE_URL` or submit equivalent configuration through the API/UI.
- Later connector issues can reuse this control plane for Slack, Google, GitHub, Linear, Notion, webhooks, CRM, and Microsoft sources.
