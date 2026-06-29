# AGE-81 Import Canonical Skill/Tool/Plugin/Cron/Agent/Policy Packages

Linear: https://linear.app/agentiwise/issue/AGE-81/import-canonical-skilltoolplugincronagentpolicy-packages

## What to build

Implement the canonical package import path for the capability registry. Users should upload or author SkillPackage, ToolDefinition, PluginPackage, CronJobDefinition, AgentDefinition, and PolicyDefinition packages, see diffs, validate manifests, and open registry changesets for review.

## Acceptance criteria

- [ ] Package import validates manifest shape, owner, tier, version, dependencies, permissions, examples, changelog, and rollback target.
- [ ] Imported packages become draft registry changesets, not published capabilities.
- [ ] UI shows package diffs, dependency graph, required tools, required permissions, and target adapters.
- [ ] Invalid packages return actionable validation errors.
- [ ] Tests cover valid import, malformed manifest, missing owner, dependency mismatch, and duplicate version.

## Blocked by

- AGE-67
