# AGE-78 Hybrid Retrieval With Tier Authority And Freshness Ranking

Linear: https://linear.app/agentiwise/issue/AGE-78/hybrid-retrieval-with-tier-authority-and-freshness-ranking

## What to build

Upgrade brain query to combine lexical search, vector search, graph/entity context, ACL checks, tier authority, freshness, and task intent. Agents and UI users should receive cited answers that prefer higher-authority reviewed memory without hiding fresher lower-tier candidates when relevant.

## Acceptance criteria

- [ ] Retrieval combines full-text, vector, and metadata filters with deterministic ranking inputs.
- [ ] ACL restrictions are enforced before answer synthesis and citations are preserved.
- [ ] Company-main memory ranks above team/individual memory when both answer the same question, unless freshness/conflict rules require surfacing both.
- [ ] Query response explains citations, freshness, confidence, and tier authority.
- [ ] Tests cover authority ranking, stale memory, restricted source exclusion, no-result behavior, and mixed-source answers.

## Blocked by

- AGE-68
- AGE-77
