# Test Plan

- Unit: company-main approved atom ranks above a team atom for the same query when both are accessible.
- Unit: stale or superseded memory is demoted below fresher reviewed/candidate memory, while still cited when relevant.
- Unit: restricted or inaccessible atoms are excluded from citations and reported as denied retrieval candidates.
- Unit: no-result query returns zero citations and a no-match explanation.
- Unit: mixed-source query returns citations from multiple tiers with ranking factors for lexical, vector, freshness, confidence, and tier authority.
- API: `POST /api/v1/brain/query` includes retrieval diagnostics while keeping the existing citations contract.

## Verification commands

- `npm test -- tests/hybrid-retrieval.test.ts`
- `npm test -- tests/hybrid-retrieval.test.ts tests/brain-api.test.ts tests/acl-enforcement.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
