import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPackageDistributionService, type PackageDistributionState, type PackageDistributionStore } from "../lib/package-distribution";
import type { AgentExportState, AgentExportStore } from "../lib/agent-exports";
import type { Principal, RegistryItem, SkillPackage, ToolDefinition } from "../lib/types";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["registry:read", "registry:install", "registry:publish", "tool:invoke"]
};

const outsider: Principal = {
  ...admin,
  id: "usr_outsider",
  role: "employee",
  tiers: ["individual"],
  scopes: ["brain:read"]
};

function skill(version: string, overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: `skill_export_${version.replace(/\./g, "_")}`,
    tenantId: "tenant_demo",
    kind: "skill",
    name: "Export Skill",
    slug: "export-skill",
    description: "Installable package for agents.",
    tier: "team",
    ownerId: "usr_admin",
    version,
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["atom_001"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    skillMarkdown: "# Export Skill\n\nUse governed memory.",
    evals: ["evals/export.yml"],
    examples: ["Install this in Codex."],
    changelog: [`${version}: Package release.`],
    rollbackTarget: version === "1.1.0" ? "1.0.0" : "0.9.0",
    ...overrides
  };
}

function tool(): ToolDefinition {
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
    inputSchema: {},
    rateLimit: "120/minute",
    secrets: [],
    auditPolicy: "log-metadata"
  };
}

function dependentPackage(): RegistryItem {
  return {
    ...skill("1.0.0"),
    id: "skill_dependent",
    name: "Dependent Skill",
    slug: "dependent-skill",
    dependencies: ["export-skill"],
    changelog: ["1.0.0: Depends on export-skill."]
  };
}

function createDistributionStore() {
  let state: PackageDistributionState | null = null;
  const store: PackageDistributionStore & { snapshot: () => PackageDistributionState | null } = {
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

function createExportStore() {
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

function registry() {
  return [skill("1.1.0"), skill("1.0.0"), tool(), dependentPackage()];
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("package distribution", () => {
  it("lists visible published packages with quality, changelog, agents, and install options", async () => {
    const service = createPackageDistributionService({
      store: createDistributionStore(),
      exportStore: createExportStore(),
      registryItems: registry()
    });

    const catalog = await service.listCatalog({ principal: admin });
    const entry = catalog.packages.find((item) => item.slug === "export-skill" && item.version === "1.1.0");

    expect(entry).toBeDefined();
    expect(entry?.qualityScore).toBeGreaterThan(80);
    expect(entry?.changelog).toContain("1.1.0: Package release.");
    expect(entry?.compatibleAgents).toEqual(["codex", "claude-code", "opencode", "generic-mcp"]);
    expect(entry?.rollbackTarget).toBe("1.0.0");
    expect(entry?.installOptions.find((option) => option.target === "codex")?.installSnippet).toContain("registry/distribution/install");
    expect(catalog.packages.every((item) => item.status === "published")).toBe(true);
  });

  it("generates an install bundle and stores a pinned version", async () => {
    const store = createDistributionStore();
    const service = createPackageDistributionService({
      store,
      exportStore: createExportStore(),
      registryItems: registry(),
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const result = await service.installPackage({
      principal: admin,
      packageId: "export-skill",
      version: "1.1.0",
      target: "codex"
    });

    expect(result.bundle.target).toBe("codex");
    expect(result.pin).toMatchObject({ packageId: "skill_export_1_1_0", version: "1.1.0", target: "codex" });
    expect(result.installSnippet).toContain(result.bundle.downloadUrl);
    expect(store.snapshot()?.pins[0]).toMatchObject({ version: "1.1.0", bundleId: result.bundle.id });
  });

  it("rolls back to a prior version, audits the change, regenerates exports, and flags dependents", async () => {
    const store = createDistributionStore();
    const service = createPackageDistributionService({
      store,
      exportStore: createExportStore(),
      registryItems: registry(),
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const result = await service.rollbackPackage({
      principal: admin,
      packageId: "export-skill",
      fromVersion: "1.1.0",
      targetVersion: "1.0.0"
    });

    expect(result.restoredPackage.version).toBe("1.0.0");
    expect(result.rollback.changeset).toMatchObject({ status: "approved", targetId: "skill_export_1_1_0" });
    expect(result.rollback.auditEvent).toMatchObject({ action: "rollback", policyDecision: "allow" });
    expect(result.rollback.dependentPackages.map((item) => item.slug)).toContain("dependent-skill");
    expect(result.bundles.every((bundle) => bundle.version === "1.0.0")).toBe(true);
    expect(store.snapshot()?.rollbacks[0]?.targetVersion).toBe("1.0.0");
  });

  it("hides and blocks installs for unauthorized principals", async () => {
    const service = createPackageDistributionService({
      store: createDistributionStore(),
      exportStore: createExportStore(),
      registryItems: registry()
    });

    const catalog = await service.listCatalog({ principal: outsider });

    expect(catalog.packages.find((item) => item.slug === "export-skill")).toBeUndefined();
    await expect(
      service.installPackage({
        principal: outsider,
        packageId: "export-skill",
        version: "1.1.0",
        target: "codex"
      })
    ).rejects.toThrow(/not authorized|scope|access/i);
  });

  it("serves catalog, install, and rollback through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-package-distribution-"));
    process.env.PACKAGE_DISTRIBUTION_STATE_PATH = join(dir, "distribution.json");
    process.env.AGENT_EXPORT_STATE_PATH = join(dir, "exports.json");
    vi.resetModules();
    const catalogRoute = await import("../app/api/v1/registry/distribution/route");
    const installRoute = await import("../app/api/v1/registry/distribution/install/route");
    const rollbackRoute = await import("../app/api/v1/registry/distribution/rollback/route");

    const catalogResponse = await catalogRoute.GET(new Request("http://localhost/api/v1/registry/distribution"));
    const catalogPayload = await catalogResponse.json();
    expect(catalogResponse.status).toBe(200);
    expect(catalogPayload.packages.length).toBeGreaterThan(0);

    const installResponse = await installRoute.POST(
      jsonRequest("/api/v1/registry/distribution/install", {
        principal: admin,
        packageId: "export-skill",
        version: "1.1.0",
        target: "opencode",
        registryItems: registry()
      })
    );
    const installPayload = await installResponse.json();
    expect(installResponse.status).toBe(200);
    expect(installPayload.pin.version).toBe("1.1.0");

    const rollbackResponse = await rollbackRoute.POST(
      jsonRequest("/api/v1/registry/distribution/rollback", {
        principal: admin,
        packageId: "export-skill",
        fromVersion: "1.1.0",
        targetVersion: "1.0.0",
        registryItems: registry()
      })
    );
    const rollbackPayload = await rollbackResponse.json();
    expect(rollbackResponse.status).toBe(200);
    expect(rollbackPayload.rollback.targetVersion).toBe("1.0.0");
  });
});
