# AI-Native Company Brain

Open-source, self-hostable company brain for governed organizational memory, approved tools and skills, plugin distribution, cron workflows, and MCP-compatible agents.

External app connections are Composio-first: Composio handles connected-account setup, toolkit/action discovery, and tool execution where supported; this app owns source normalization, ACL inheritance, review, audit, and memory quality.

## Quick Start

```bash
npm install
npm run render:architecture
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without `DATABASE_URL`, the app runs against the typed seed repository for local demos.

## Self-Host Stack

```bash
docker compose up --build
```

This starts:

- Next.js app and API
- Postgres with `pgvector`
- Redis queue
- MinIO object storage

To initialize a standalone Postgres database outside Docker:

```bash
export DATABASE_URL=postgres://brain:brain@localhost:5432/company_brain
npm run db:migrate
npm run db:seed
```

## Important Files

- `docs/implementation-design.md`: implementation design and architecture diagram
- `docs/phase-wise-prd.md`: phase-wise PRD from scaffold to production-ready system
- `db/schema.sql`: production persistence model
- `app/api/mcp/route.ts`: MCP-compatible JSON-RPC endpoint
- `lib/adapters.ts`: Codex, Claude Code, OpenCode, and generic agent adapter generation
- `app/page.tsx`: operator console UI

## Current Status

This is a runnable v0 scaffold with a repository boundary. Seed mode keeps local demos instant, while `DATABASE_URL` switches the UI, API, MCP endpoint, registry, cron runs, changesets, atoms, artifacts, and audit events to Postgres.
