# Implementation Plan

## Slice

Add a file-backed compliance workflow service that manages retention rules, legal holds, memory exports, and answer audit packs, then expose it through API routes and the operations dashboard.

## Design

- Persist compliance state in `data/compliance-workflows-state.json` by default with env override.
- Add retention rules that match source type, tier, and sensitivity with explicit deletion behavior.
- Run retention against the repository dashboard snapshot and source artifact metadata, recording deleted/held/review-only atom ids in an audit-safe ledger.
- Add legal holds for atoms, artifacts/sources, and principals; active holds block deletion and emit audit events.
- Export individual or organization memory with atom data, source context, lineage, policy context, and denied reasons.
- Build answer audit packs from a repository query, lineage lookups, source metadata, query/answer/tool/cron events, and policy decisions.
- Add API routes for status, retention configure/run, legal holds, memory exports, and answer audit packs.
- Add a dashboard panel showing retention rules, legal holds, exports, packs, retention runs, and audit events.

## Boundaries

- Retention v1 records deletion decisions and tombstones in the compliance ledger. It does not physically mutate Postgres/seed atoms until the repository contract grows a dedicated delete/tombstone method.
