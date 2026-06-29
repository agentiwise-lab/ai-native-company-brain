import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentExportService, type AgentExportState, type AgentExportStore } from "../lib/agent-exports";
import type { SkillPackage, ToolDefinition } from "../lib/types";

function skill(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: "skill_export",
    tenantId: "tenant_demo",
    kind: "skill",
    name: "Export Skill",
    slug: "export-skill",
    description: "A published skill that should export to every agent.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.1.0",
    status: "published",
    permissions: ["brain:read", "registry:read", "tool:invoke"],
    dependencies: ["atom_001"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    skillMarkdown: "# Export Skill\n\nUse Company Brain memory and approved tools.",
    evals: ["evals/export/grounding.yml"],
    examples: ["Create an onboarding brief with citations."],
    changelog: ["1.1.0: Added OpenCode permissions.", "1.0.0: Initial package."],
    rollbackTarget: "1.0.0",
    ...overrides
  };
}

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tool_brain_query",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Brain Query",
    slug: "brain-query",
    description: "Query governed Company Brain memory.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["brain:read"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    toolType: "mcp",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    rateLimit: "120/minute/tenant",
    secrets: [],
    auditPolicy: "log-metadata",
    ...overrides
  };
}

function createStore() {
  let state: AgentExportState | null = null;
  const store: AgentExportStore & { snapshot: () => AgentExportState | null } = {
    async read() {
      return state;
    },
    async write(next) {
      state = next;
    },
    snapshot() {
      return state;
    }
  };
  return store;
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("agent export bundles", () => {
  it("generates Codex, Claude Code, OpenCode, and generic artifacts with package metadata", async () => {
    const service = createAgentExportService({
      store: createStore(),
      registryItems: [skill(), tool()],
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const result = await service.generatePackageExports({ packageId: "skill_export" });

    expect(result.bundles.map((bundle) => bundle.target).sort()).toEqual(["claude-code", "codex", "generic-mcp", "opencode"]);
    expect(result.bundles.every((bundle) => bundle.downloadUrl.startsWith("/api/v1/registry/exports/"))).toBe(true);
    expect(result.bundles.find((bundle) => bundle.target === "codex")?.files.map((file) => file.path)).toContain(
      "codex/company-brain/.codex-plugin/manifest.json"
    );
    expect(result.bundles.find((bundle) => bundle.target === "generic-mcp")?.files.map((file) => file.path)).toContain(
      "generic-agents/.agents/skills/export-skill/SKILL.md"
    );
    const payload = JSON.stringify(result.bundles);
    expect(payload).toContain("/api/mcp");
    expect(payload).toContain("brain:read");
    expect(payload).toContain("tool:invoke");
    expect(payload).toContain("Create an onboarding brief with citations.");
    expect(payload).toContain("1.1.0: Added OpenCode permissions.");
    expect(payload).toContain("\"version\":\"1.1.0\"");
    expect(payload).toContain("\"rollbackTarget\":\"1.0.0\"");
  });

  it("fails generation when a permission cannot be mapped to agent permissions", async () => {
    const service = createAgentExportService({
      store: createStore(),
      registryItems: [skill({ permissions: ["vendor:unknown"] }), tool()]
    });

    await expect(service.generatePackageExports({ packageId: "skill_export" })).rejects.toThrow(/Unsupported permission mapping/i);
  });

  it("fails generation when registry dependencies or required tools are missing", async () => {
    const service = createAgentExportService({
      store: createStore(),
      registryItems: [skill({ dependencies: ["skill_missing"], requiredTools: ["tool_missing"] })]
    });

    await expect(service.generatePackageExports({ packageId: "skill_export" })).rejects.toThrow(/Missing dependencies.*skill_missing.*Missing required tools.*tool_missing/i);
  });

  it("preserves rollback target when exporting a newer version", async () => {
    const service = createAgentExportService({
      store: createStore(),
      registryItems: [skill({ version: "1.2.0", rollbackTarget: "1.1.0" }), tool()]
    });

    const result = await service.generatePackageExports({ packageId: "export-skill", targets: ["opencode"] });

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.manifest.package).toMatchObject({
      slug: "export-skill",
      version: "1.2.0",
      rollbackTarget: "1.1.0"
    });
  });

  it("generates and downloads bundles through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-agent-exports-"));
    process.env.AGENT_EXPORT_STATE_PATH = join(dir, "exports.json");
    vi.resetModules();
    const exportRoute = await import("../app/api/v1/registry/exports/route");
    const downloadRoute = await import("../app/api/v1/registry/exports/[id]/download/route");

    const response = await exportRoute.POST(
      jsonRequest("/api/v1/registry/exports", {
        packageId: "skill_export",
        targets: ["opencode"],
        registryItems: [skill(), tool()]
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.bundles).toHaveLength(1);
    expect(payload.bundles[0].downloadUrl).toContain(payload.bundles[0].id);

    const download = await downloadRoute.GET(new Request(`http://localhost${payload.bundles[0].downloadUrl}`), {
      params: Promise.resolve({ id: payload.bundles[0].id })
    });
    const bundle = await download.json();

    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("opencode-export-skill-1.1.0.json");
    expect(bundle.files.some((file: { path: string }) => file.path.endsWith("opencode.json"))).toBe(true);
  });
});
