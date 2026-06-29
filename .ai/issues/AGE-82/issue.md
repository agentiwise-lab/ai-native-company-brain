# AGE-82 Gate Package Publication With Sandbox, Evals, And Security Scan

Linear: https://linear.app/agentiwise/issue/AGE-82/gate-package-publication-with-sandbox-evals-and-security-scan

## What to build

Add the governed publication pipeline for registry packages. Shared skills, tools, plugins, cron jobs, agents, and policies should only publish after linting, sandbox tests, eval runs, security scanning, owner review, tier approval, adapter generation checks, and canary/rollback metadata.

## Acceptance criteria

- [ ] Registry changesets show required checks and block publish until all mandatory checks pass.
- [ ] Sandbox tests and eval results are stored with package version and reviewer context.
- [ ] Security scan flags unsafe permissions, secret exposure, suspicious scripts, prompt injection patterns, and missing audit policy.
- [ ] Reviewer approval publishes the package and creates rollback metadata.
- [ ] Tests cover missing evals, unsafe permission, failed adapter generation, no reviewer, and successful publish.

## Blocked by

- AGE-81
