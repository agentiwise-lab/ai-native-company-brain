# Test Plan For AGE-63: Boot Tenant With Persisted Admin Setup

## Acceptance Criteria Coverage

| Criterion | Test or verification |
| --- | --- |
| Fresh deployment shows setup flow instead of seeded dashboard. | Unit test `getSetupState` on empty temp path; build verifies page can render setup branch. |
| Admin can create tenant, first user, encryption/settings record, and initial brain tiers. | Unit test `bootstrapTenant` writes expected tenant/admin/settings/tiers shape. |
| Setup state persists across reloads and service restarts. | Unit test creates state, reloads module/store by reading from disk, and asserts persisted values. |
| Setup emits immutable audit events for tenant creation and admin bootstrap. | Unit test asserts audit event actions and metadata after bootstrap. |
| Automated tests cover completed setup, incomplete setup, and duplicate bootstrap attempts. | `tests/setup.test.ts` covers all three states and validation failures. |

## TDD Notes

- First failing test: empty setup path returns `isComplete: false`.
- Expected failure: `lib/setup.ts` does not exist.
- Implementation note: keep the store pure and environment-path driven so tests do not touch real `data/`.

## Commands

```bash
npm test -- tests/setup.test.ts
npm run ci
```

