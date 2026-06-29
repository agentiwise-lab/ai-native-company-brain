# AI-Native Company Brain: Phase-Wise PRD

## 0. Current Reality

The current app is a runnable v0 scaffold, not the working product. It looks like a simple static HTML dashboard because the operator console is server-rendered from seed data, and the buttons, setup flows, connectors, review actions, scheduler workers, and database-backed state are not implemented yet.

The scaffold proves the shape: tiers, registry, MCP endpoint, API route names, schema, Docker stack, and architecture docs. The production product starts when those surfaces are backed by real auth, Postgres persistence, connector sync, review workflows, scheduled jobs, and agent clients.

## 1. Product Thesis

Build an open-source, self-hostable operating system for organizational knowledge and agent capabilities. It should let an enterprise connect the tools where work already happens, passively capture source-backed knowledge, promote it through PR-style review, and expose the right memory, skills, tools, plugins, policies, and cron jobs to Codex, Claude Code, OpenCode, and any MCP-compatible agent.

The buyer should be able to choose:

- Self-hosted: Docker Compose for small teams, Helm/Kubernetes for production.
- Managed cloud: hosted database, storage, backups, SSO/SCIM, connector operations, monitoring, upgrades, and support.

## 2. Users And Jobs

### Primary Personas

- Admin/operator: sets up tenant, identity, connectors, retention, policies, registry permissions, and health checks.
- Brain reviewer: reviews memory and registry changesets, resolves conflicts, and owns quality.
- Team lead/domain owner: curates team and department brain, owns domain-specific skills and tools.
- Employee: asks the agent questions, commits decisions, requests summaries, and uses approved skills.
- Agent: queries memory, opens changesets, runs allowed tools, executes cron jobs, and emits audit events.
- Security/compliance reviewer: audits access, exports, retention, sensitive data, and tool execution.

### Jobs To Be Done

- Connect organizational systems without making employees manually document work.
- Convert work artifacts into source-backed candidate knowledge.
- Promote only reviewed, owned, fresh knowledge into higher tiers.
- Publish approved tools and skills to the agents people already use.
- Schedule recurring agent workflows with audit, budget, and approval gates.
- Trace every answer and tool action back to source, reviewer, policy, and event history.

## 3. Product Principles

- Agent-native first: the employee interface is the agent; the UI is for setup, review, audit, and operations.
- Source-backed truth: no promoted company memory without provenance.
- Review before authority: moving up tiers requires review, ownership, and freshness.
- ACLs are inherited: derived memory inherits the most restrictive source permission.
- Registry equals code: skills, tools, plugins, cron jobs, agents, and policies are versioned, reviewed, tested, published, monitored, and rolled back.
- Composio-first integrations: use Composio for connected accounts, toolkit discovery, tool execution, and integration setup wherever it supports the needed source, with native fallback only when source ACL or sync depth requires it.
- Self-host should be real: no cloud-only hidden dependencies for core usage.

## 4. Core Product Modules

### Setup Console

- Tenant creation and encryption key setup.
- Admin user bootstrap.
- SSO/OIDC/SAML setup.
- SCIM org sync.
- Source connector setup.
- Default tier, reviewer, retention, and export policies.
- First-run diagnostics.

### Composio-Backed Source Connectors

- Composio auth-config and connected-account setup.
- Composio sessions as the runtime context for each user or agent run, with restricted toolkits/actions based on internal registry policy.
- Toolkit/action discovery for each enabled app.
- Tenant mapping from Composio connected accounts to internal principals, teams, and source scopes.
- Backfill, incremental sync, and webhook ingestion.
- Source normalization into `SourceArtifact`.
- Per-source ACL and sensitivity extraction.
- Checkpointing, retry, rate-limit handling, and connector health.
- Native connector fallback only when Composio does not expose required permissions, deltas, webhooks, or source-level ACLs.

### Brain Compiler

- Artifact parsing, chunking, dedupe, PII/sensitive classification.
- Candidate atom extraction.
- Entity and project linking.
- Contradiction and duplicate detection.
- Quality score calculation.
- Changeset creation and owner assignment.

### Review And Promotion

- PR-style changesets for atoms and registry items.
- CODEOWNERS-style reviewers per tier/domain.
- Required checks: owner, source evidence, ACL, freshness, conflict, eval, tool safety.
- Merge, reject, request changes, demote, supersede, and rollback.
- Full lineage and audit trail.

### Retrieval And Agent API

- Hybrid retrieval: lexical, vector, graph, tier authority, freshness, ACL, task intent.
- Cited answers with confidence and source freshness.
- MCP-compatible tools/resources/prompts.
- REST API for non-MCP clients.
- Agent-specific adapter generation.

### Tools, Skills, Plugins, Cron Registry

- Canonical package spec for skills, tools, plugins, agents, cron jobs, and policies.
- Per-tier registry visibility and publication.
- Sandbox tests, evals, security scans, canary rollout, rollback.
- Native exports for Codex, Claude Code, OpenCode, and generic `.agents`.

### Scheduler And Maintenance Loops

- Durable cron definitions.
- Worker leasing and run history.
- Approval gates for sensitive output and tool execution.
- Budget, runtime, retry, and notification policy.
- Weekly brain health, stale review, registry drift, failed connector, and skill impact reports.

### Audit And Compliance

- Immutable `BrainEvent` ledger.
- Trace answer -> atoms -> sources -> reviewers -> policies -> tools -> cron runs.
- Export individual and organization-owned memory.
- Retention and deletion workflows.
- Admin reports for sensitive data, blocked tools, failed access, and offboarding.

## 5. Integration Requirements

### Identity And Access

| Integration | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| OIDC | Login and basic SSO | Phase 1 | Required for self-host MVP. |
| SAML | Enterprise SSO | Phase 6 | Cloud and regulated deployments. |
| SCIM | User/team sync | Phase 3 | Drives org graph and ACL inheritance. |
| Google Workspace Directory | User/team import | Phase 2 | Useful before SCIM in smaller orgs. |
| Microsoft Entra ID | User/team import | Phase 2 | Needed for M365 customers. |

### Connector Platform

| Platform | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| Composio | Default app connection, auth, sessions, toolkit/action discovery, MCP, and tool execution layer | Phase 2 | Enterprises connect Slack, Google, GitHub, Linear, Notion, and other work tools through Composio-backed sessions, auth configs, and connected accounts. |
| Native adapters | Fallback for sources that require deeper ACL, delta sync, or compliance controls than Composio exposes | Phase 3+ | Used selectively; native code must still emit the same `SourceArtifact`, ACL, checkpoint, and audit records. |

### Work Capture

| Integration | Captured Data | Sync Mode | Phase |
| --- | --- | --- | --- |
| Slack | channels, threads, files, user groups | Composio-first auth/actions; native events fallback if required | Phase 2 |
| Microsoft Teams | chats, channels, meetings | Composio-first; Microsoft Graph native fallback | Phase 3 |
| Gmail | emails, threads, labels | Composio-first auth/actions; native history fallback if required | Phase 2 |
| Outlook | emails, calendar, attachments | Composio-first; Microsoft Graph native fallback | Phase 3 |
| Google Drive | docs, sheets, slides, permissions | Composio-first auth/actions; Drive changes fallback if required | Phase 2 |
| SharePoint/OneDrive | docs, permissions | Composio-first; Microsoft Graph native fallback | Phase 3 |
| Notion | pages, databases, comments | Composio-first auth/actions; polling fallback if required | Phase 2 |
| Confluence | spaces, pages, comments | Composio-first; native webhook/polling fallback | Phase 3 |
| Linear | issues, comments, projects | Composio-first auth/actions; native webhooks fallback if required | Phase 2 |
| Jira | issues, comments, projects | Composio-first; native webhooks fallback if required | Phase 3 |
| GitHub | repos, PRs, issues, discussions | Composio-first auth/actions; GitHub App fallback if required | Phase 2 |
| GitLab | repos, MRs, issues | Composio-first; native fallback if required | Phase 4 |
| Zoom | transcripts, recordings metadata | Composio-first; native webhooks fallback if required | Phase 3 |
| Google Meet | transcripts via Drive/Calendar sources | Composio-backed Google sources | Phase 3 |
| Salesforce | accounts, opportunities, notes | Composio-first; native CDC fallback if required | Phase 4 |
| HubSpot | companies, deals, notes | Composio-first; native webhooks fallback if required | Phase 4 |

### Agent And Automation Surfaces

| Surface | Integration Mechanism | Phase | Done Means |
| --- | --- | --- | --- |
| MCP clients | Hosted/self-hosted MCP server | Phase 2 | Tools list, query, commit, registry search, cron run work from external client. |
| Codex | Plugin + skills + MCP config export | Phase 4 | Published skills appear and can call Company Brain MCP. |
| Claude Code | Plugin/marketplace shape + `.claude/skills` + MCP | Phase 4 | Same canonical skills work in Claude Code. |
| OpenCode | `.opencode/skills`, `.opencode/tools`, `opencode.json` | Phase 4 | Skills and tools load with permission rules. |
| n8n | Webhook/API nodes or community node | Phase 5 | Brain events trigger n8n workflows and n8n can open changesets. |
| Zapier/Make | Webhooks/API | Phase 6 | Cloud users can automate low-risk workflows. |

## 6. Phase Plan

### Phase 0: Scaffold And Product Contract

Goal: Establish the architecture, data model, API names, UI direction, and self-host stack.

Already implemented:

- Next.js app shell.
- Seeded operator dashboard.
- Typed domain model.
- REST route skeletons.
- MCP-compatible JSON-RPC route.
- Postgres schema.
- Docker Compose stack.
- Architecture image, Mermaid source, and compatibility examples.

Not done:

- Real database persistence.
- Real auth.
- Real integrations.
- Real UI actions.
- Real scheduler worker.
- Real package publishing.

Exit criteria:

- Build and typecheck pass.
- PRD and implementation design exist.
- No claim that scaffold is production-ready.

### Phase 1: Working Self-Hosted Core

Goal: Turn the scaffold into a real single-tenant product that can persist state, authenticate admins, and operate against local infrastructure.

Must ship:

- Postgres repository replacing in-memory seed data.
- Migrations and seed command.
- Admin bootstrap flow.
- Email/password or OIDC login.
- Tenant settings page.
- Real CRUD for atoms, changesets, registry items, and cron definitions.
- UI actions for query, commit, open changeset, approve/reject, publish, rollback, run cron now.
- Event ledger writes for every mutation.
- Docker Compose production profile.

Data work:

- Add migration runner.
- Add row-level tenant scoping in repository layer.
- Add transaction boundaries for changeset merge, registry publish, rollback, and cron run creation.

Acceptance criteria:

- Fresh clone can run `docker compose up --build`.
- Admin can create tenant and log in.
- Creating a candidate atom writes to Postgres.
- Reviewing a changeset updates database state and emits `BrainEvent`.
- Reloading the page preserves data.

### Phase 2: First Real Integrations And MCP MVP

Goal: Capture work from real tools and let external agents query governed memory.

Must ship integration substrate:

- Composio project/app configuration for self-host and cloud.
- Composio auth-config setup flow in the setup wizard.
- Composio session creation and reuse for interactive agents, connector workers, and cron jobs.
- Composio connected-account lifecycle: connect, refresh, revoke, test, and reauthorize.
- Composio toolkit/action discovery mapped into internal `ToolDefinition` and source-connector definitions.
- Slack, Google Drive, Gmail, Linear, GitHub, and Notion ingestion through Composio where supported.
- Native fallback contract for source ACL, delta sync, or webhook gaps.
- Generic webhook ingestion.

Must ship agent surface:

- MCP server endpoint with standard initialization, tools/list, tools/call, resources/list, resources/read, prompts/list.
- OAuth/API-key auth for agent clients.
- `brain.query`, `brain.commit`, `registry.search`, `audit.trace`.
- Local test client script for MCP smoke tests.

Connector requirements:

- Composio connect flow with tenant-scoped connected accounts.
- Backfill date range selection.
- Incremental sync checkpoint.
- Webhook handler where available.
- Connector health page.
- Source artifact viewer.
- ACL extraction from source where possible.
- Manual sensitivity override.

Acceptance criteria:

- Slack thread becomes a `SourceArtifact`.
- Google Doc content becomes a `SourceArtifact` with source ACL metadata.
- GitHub PR discussion can be queried through `brain.query`.
- A Composio connected account can be revoked and all future sync/tool calls stop for that account.
- External MCP client can list and call tools.
- All connector syncs emit audit events.

### Phase 3: Memory Compiler And Review System

Goal: Convert raw artifacts into useful, reviewed organizational memory.

Must ship:

- Artifact parser and chunker.
- Embeddings pipeline.
- Full-text and vector retrieval.
- Candidate atom extraction worker.
- Duplicate detection.
- Contradiction detection.
- Owner assignment rules.
- Review queue UI with diffs.
- Conflict resolution workflow.
- Stale review dates and demotion.
- Quality scoring v1.

AI requirements:

- Model-provider abstraction for OpenAI, Anthropic, local OpenAI-compatible endpoints, and optional self-host models.
- Prompt/version registry for extraction and review-assist prompts.
- Evaluation set for extraction quality and ACL leakage.

Acceptance criteria:

- A synced meeting transcript produces candidate decision/procedure/lesson atoms.
- Reviewer can merge, reject, edit, or request source evidence.
- A contradiction opens a conflict changeset.
- A stale atom appears in weekly review.
- Retrieval prefers company-main over team memory when both answer the same question.

### Phase 4: Tools, Skills, Plugins, And Agent Compatibility

Goal: Make the registry a real distribution system for agent capabilities.

Must ship:

- Canonical package spec for `SkillPackage`, `ToolDefinition`, `PluginPackage`, `AgentDefinition`, `CronJobDefinition`, and `PolicyDefinition`.
- Package upload/import.
- Registry item diff UI.
- Sandbox test runner.
- Eval runner.
- Tool permission scanner.
- Adapter generation service.
- Codex plugin export.
- Claude Code export.
- OpenCode export.
- Generic `.agents/skills` export.
- Package install URLs or downloadable bundles.

Registry checks:

- Owner exists.
- Required evals passed.
- Tool permissions are reviewed.
- Required tools exist and are published.
- Dependencies are not blocked/deprecated.
- Adapter generation succeeds.
- Higher-tier publication has reviewer approval.

Acceptance criteria:

- A skill authored once exports to Codex, Claude Code, OpenCode, and generic agents.
- A risky tool is blocked until policy approval.
- A policy atom change flags dependent skills for review.
- A rollback restores the previous published package.

### Phase 5: Durable Scheduler And Self-Sustaining Loops

Goal: Make the system maintain itself through scheduled agent workflows.

Must ship:

- Postgres-backed scheduler.
- Worker process separate from web app.
- Job lease locking with `FOR UPDATE SKIP LOCKED`.
- Retry, timeout, and budget enforcement.
- Approval gates.
- Output destinations: Slack, email, webhook, dashboard.
- Cron run log and replay.
- Maintenance agents:
  - Brain health report.
  - Stale atom review.
  - Registry drift scan.
  - Connector failure triage.
  - Skill impact report.
  - Offboarding export assistant.

Acceptance criteria:

- 1,000 cron jobs can be scheduled without duplicate execution.
- Failed jobs retry according to policy.
- Sensitive output pauses for approval.
- Weekly brain health opens concrete changesets.
- Cron jobs cannot access tools outside their allowed policy.

### Phase 6: Enterprise Security, Compliance, And Scale

Goal: Make the product deployable in serious enterprise environments.

Must ship:

- SAML SSO.
- SCIM provisioning.
- Multi-tenant isolation for cloud.
- Tenant-level encryption keys.
- Secret manager integration.
- Role and attribute-based access policy editor.
- Source ACL inheritance enforcement.
- Data retention and legal hold.
- Offboarding workflow.
- Export packs.
- Audit search and reporting.
- Observability: logs, metrics, traces.
- Backup and restore.
- Helm chart and Kubernetes deployment docs.

Security requirements:

- Prompt injection detection on source artifacts.
- Secret scanning.
- PII classification.
- Tool execution sandboxing.
- Admin approval for dangerous tools.
- Immutable audit events.
- Break-glass admin flow.

Acceptance criteria:

- SCIM deactivation removes user access.
- Restricted source memory is never returned to unauthorized agents.
- Backup restore passes integrity check.
- Compliance admin can export audit trail for an answer.
- Security scan blocks malicious skill packages.

### Phase 7: Managed Cloud And Marketplace

Goal: Offer the hosted version that removes operational burden.

Must ship:

- Cloud tenant provisioning.
- Hosted Postgres, object storage, Redis/queue.
- Managed connector workers.
- Managed scheduler.
- Usage metering.
- Billing.
- Plan limits.
- Admin support tooling.
- Upgrade orchestration.
- Public/private plugin marketplace.
- Partner connector framework.

Cloud value:

- Managed databases and backups.
- Managed ACL and connector operations.
- Enterprise SSO support.
- Monitoring and alerting.
- Compliance reports.
- Support for plugin and skill distribution.

Acceptance criteria:

- New cloud tenant reaches first useful synced answer in under one hour.
- Cloud and self-host use the same package format and MCP/API surface.
- Customers can export data and migrate from cloud to self-host.

## 7. Ready-To-Work Definition

The product is ready to work for a real organization only when all of these are true:

- Admin can connect identity and at least three real work tools.
- Source artifacts sync continuously with health and audit.
- Employees can query the brain through an agent and receive cited answers.
- Reviewers can promote, reject, edit, demote, and rollback memory.
- Skills and tools can be published through review and consumed by at least one external agent.
- Cron jobs execute on schedule with audit, budgets, retries, and approvals.
- ACL tests prove restricted data is not leaked.
- Offboarding export and access revocation work.
- Backup/restore is tested.

## 8. MVP Scope Recommendation

Do not try to build every connector first. The first sellable MVP should focus on one strong wedge:

1. Composio-backed Slack + Google Drive + GitHub + Linear ingestion.
2. Postgres-backed brain and source artifacts.
3. MCP server for external agents.
4. Review workflow for memory changesets.
5. Skill registry with Codex and OpenCode exports.
6. Weekly brain health cron.

This is enough to demonstrate the product promise: passive capture, source-backed memory, review-gated promotion, agent retrieval, and self-maintenance.

## 9. Metrics

### Activation

- Time to first connected source.
- Time to first source-backed answer.
- Time to first merged atom.
- Time to first published skill.

### Quality

- Retrieval precision.
- Citation coverage.
- ACL denial correctness.
- Changeset acceptance rate.
- Stale atom ratio.
- Contradiction resolution time.

### Operations

- Connector lag.
- Failed sync rate.
- Cron success rate.
- Worker queue depth.
- Storage growth.
- Backup restore success.

### Business

- Weekly active agent users.
- Repeated question reduction.
- Review queue throughput.
- Number of published skills/tools.
- Number of workflows automated by cron.

## 10. Non-Goals For V1

- Replacing all company tools.
- Fully autonomous company-main writes.
- Replacing human managers.
- Building a general no-code automation platform.
- Supporting every enterprise connector at launch.
- Public marketplace before internal registry is reliable.

## 11. Biggest Risks

- ACL leakage from derived memory.
- Noisy extraction polluting the brain.
- Connector complexity delaying MVP, especially if Composio tool coverage lacks required ACL or delta-sync fidelity for a source.
- Employees treating uncited agent answers as truth.
- Skill registry becoming another ungoverned prompt library.
- Cron jobs creating silent operational drift.
- Self-host setup becoming too hard for non-platform teams.

## 12. Immediate Next Engineering Tasks

1. Replace `lib/repository.ts` with a Postgres-backed repository.
2. Add migrations and seed CLI.
3. Implement auth and tenant bootstrap.
4. Make UI actions real for brain query, commit, review, publish, rollback, and cron run.
5. Add Composio configuration, connected-account setup, and toolkit/action discovery.
6. Build Composio-backed Slack, Google Drive, GitHub, Linear, and Notion ingestion slices.
7. Implement durable scheduler worker.
8. Add MCP auth and external smoke-test client.
9. Add integration tests for ACL, changeset merge blockers, and registry publication.
10. Add a setup wizard that makes the app feel like a real product, not a static dashboard.
