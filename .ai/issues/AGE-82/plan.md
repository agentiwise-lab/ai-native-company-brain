# Implementation Plan

## Vertical slice

Add a publication gate service for canonical registry packages. It evaluates mandatory checks, stores package-version check results, blocks publish when checks fail or reviewer context is missing, and records rollback/canary metadata on successful publish.

## Design

- Add `lib/registry-publication.ts`.
- Checks: manifest lint, sandbox test, eval run, security scan, owner review, tier approval, adapter generation, rollback/canary metadata.
- Security scan flags unsafe write permissions, secret exposure, suspicious scripts, prompt injection patterns, and missing tool audit policy.
- Publish returns blocked decision unless all mandatory checks pass and reviewer id is present.
- Add status/check/publish routes.
- Add dashboard visibility for gated publication checks.

## Non-goals

- No real external sandbox runner yet; v1 stores deterministic check results and accepts supplied sandbox/eval outcomes.
- No install/export generation; AGE-84/85 owns adapters and install packages.
