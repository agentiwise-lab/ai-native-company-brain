# Agent Workflow

This repository is managed from Linear. Treat Linear issue descriptions as the source of truth for scope and blockers.

## Required Loop

1. Pick an unblocked issue:
   - Preferred: `npm run issue:pick -- AGE-63`
   - Automatic picker: `npm run issue:pick`
2. Read `.ai/issues/<issue>/issue.md`, then write or update:
   - `.ai/issues/<issue>/plan.md`
   - `.ai/issues/<issue>/test-plan.md`
3. Before any chat/context reset, run `npm run issue:checkpoint -- <issue>` and confirm the plan and tests are current on disk.
4. Implement with TDD:
   - Write or update failing tests first.
   - Run the narrow test command and confirm it fails for the expected reason.
   - Implement the smallest production change that satisfies the test.
   - Keep expanding tests until the issue acceptance criteria are covered.
5. Run the full gate: `npm run issue:verify -- <issue>`.
6. Only after the full gate passes, run `npm run issue:finish -- <issue>`.

`issue:finish` is intentionally strict: it verifies, commits, pushes the current branch, and only then marks the Linear issue Done.

## Invariants

- Do not mark a Linear issue Done until code is committed and pushed.
- Do not commit if `npm run ci` fails.
- Do not implement from memory after a context reset; reload the issue artifact, plan, and test plan from `.ai/issues/<issue>/`.
- Do not bypass Composio, ACL, audit, or registry policy requirements when an issue touches integrations, tools, skills, cron, or agent surfaces.
- Preserve source-backed knowledge, review gates, and auditability as product-level invariants.

