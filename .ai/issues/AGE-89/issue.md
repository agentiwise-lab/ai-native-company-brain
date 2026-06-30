# AGE-89 Registry Drift And Skill Impact Maintenance Agent

Linear: https://linear.app/agentiwise/issue/AGE-89/registry-drift-and-skill-impact-maintenance-agent

## What To Build

Create the registry maintenance agent that detects stale packages, dependency changes, policy changes, broken adapters, low eval scores, usage drops, rollback risk, and Composio toolkit changes. It should open concrete registry changesets or review tasks when capabilities need curation.

## Acceptance Criteria

- Scheduled scan detects changed dependencies, deprecated tools, failed evals, broken adapters, low usage, and Composio toolkit drift.
- Dependent skills/tools/plugins/cron jobs are flagged when a policy atom or tool definition changes.
- Agent opens registry changesets or review tasks with affected package versions, evidence, and recommended action.
- Risky changes pause for owner/reviewer approval before promotion or rollback.
- Tests cover dependency change, policy change, Composio action removal, broken adapter, and duplicate review prevention.

## Blocked By

- AGE-85
- AGE-86
