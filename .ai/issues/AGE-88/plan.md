# Implementation Plan

## Slice

Add a weekly brain health agent service that can be enabled as a durable cron job and, when run, converts memory health findings into concrete changesets with linked evidence and reviewer context.

## Design

- Add file-backed state for enabled job config, runs, recommendations, opened changesets, and audit events.
- Enable job with owner, tier, budget, output destination, schedule, and approval gates.
- Analyze atoms, quality scores, unresolved conflicts, source health, and failed-query counts.
- Create recommendations for refresh, demotion, supersession, and owner assignment.
- Open one changeset per actionable recommendation with source data, affected atom, reviewer, and policy context in the summary/check details.
- Prevent duplicate open changesets for the same atom/action/policy key.
- Pause when approval gates are requested and fail when budget is exhausted.
- Add API routes to enable the agent, run it, and inspect status.
- Add dashboard visibility for recommendations and opened changesets.

## Boundaries

- This slice opens changesets; final review/merge remains in existing review flows.
- Source health and failed-query inputs are service inputs for v1; future scheduler agents can populate them automatically.
