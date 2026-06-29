# AGE-84 Generate Codex, Claude Code, OpenCode, And Generic Agent Exports

Linear: https://linear.app/agentiwise/issue/AGE-84/generate-codex-claude-code-opencode-and-generic-agent-exports

## What To Build

Generate native adapter packages from the canonical registry spec. A published skill, tool, or plugin should export consistently to Codex plugin/skills/MCP config, Claude Code skill/plugin shape, OpenCode skills/tools/opencode permissions, and generic `.agents` instructions without hand-maintaining separate package definitions.

## Acceptance Criteria

- Published canonical packages generate Codex, Claude Code, OpenCode, and generic `.agents` artifacts.
- Generated exports include tool permissions, required MCP endpoints, examples, changelog, version, and rollback metadata.
- Adapter generation failures block publication or promotion.
- UI/API provide downloadable bundles or install URLs for each supported agent surface.
- Tests cover successful generation, missing permission mapping, unsupported dependency, and version rollback export.

## Blocked By

- AGE-82
- AGE-83
