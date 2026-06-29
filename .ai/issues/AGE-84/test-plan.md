# Test Plan

- `tests/agent-exports.test.ts`
  - Generates Codex, Claude Code, OpenCode, and generic bundles for a published skill and verifies files/metadata include MCP endpoint, permissions, examples, changelog, version, and rollback target.
  - Fails generation when a package uses an unsupported permission mapping.
  - Fails generation when a package has a missing registry dependency or missing required tool.
  - Preserves rollback target when generating a new package version.
  - API route returns downloadable bundle metadata and redownloads a generated JSON bundle.
- Update `tests/registry-publication.test.ts`
  - Adapter generation check fails when permission mappings are invalid.

## Required Verification

- `npm test -- tests/agent-exports.test.ts tests/registry-publication.test.ts`
- `npm test`
- `npm run build`
