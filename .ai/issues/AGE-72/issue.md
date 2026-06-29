# AGE-72 - Composio-backed GitHub and Linear ingestion

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-72/composio-backed-github-and-linear-ingestion
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Deliver the engineering/product work-source integration through Composio. Admins should connect GitHub and Linear, select repos/projects/teams, sync PRs, issues, comments, discussions, and project metadata into source artifacts, then make reviewed artifacts queryable by authorized users and agents.

## Acceptance criteria

- GitHub and Linear connected accounts can be configured, tested, revoked, and reauthorized.
- Selected repos, PRs, issues, discussions, Linear projects, issues, and comments sync into normalized source artifacts.
- Artifacts preserve source URLs, authorship, timestamps, repo/project context, status, labels, and available permission metadata.
- Reviewed GitHub/Linear-derived memory is queryable with citations and can seed candidate changesets.
- Tests cover deleted/renamed sources, missing permissions, pagination, duplicate comments, and revoked accounts.

## Blocked by

- AGE-69 - Normalize Composio outputs into source artifacts
