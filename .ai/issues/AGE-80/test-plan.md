# Test Plan

- Unit: stale atom with weak source health opens a refresh/demote review item.
- Unit: low-quality atom can be demoted/resolved with audit event.
- Unit: correction feedback lowers score and raises review priority.
- Unit: retrieval ranking uses quality score to prefer a high-quality atom over a lower-quality match.
- API: quality loop status/run/resolve routes expose queue and reviewer actions.

## Verification commands

- `npm test -- tests/memory-quality-loop.test.ts`
- `npm test -- tests/memory-quality-loop.test.ts tests/hybrid-retrieval.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
