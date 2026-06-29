# Codex Compatibility Pack

The runtime generator in `lib/adapters.ts` emits a Codex plugin package from the canonical registry. The plugin should include approved `SKILL.md` files and an MCP server config pointing at `/api/mcp`.

Install shape:

```text
company-brain/
  .codex-plugin/manifest.json
  skills/<skill>/SKILL.md
```

The source of truth is never this folder; this folder documents the exported shape.
