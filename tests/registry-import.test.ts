import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRegistryImportService, type RegistryImportState, type RegistryImportStore } from "../lib/registry-import";
import { registry } from "../lib/seed";
import type { SkillPackage } from "../lib/types";

function createStore(initial?: Partial<RegistryImportState>) {
  let state: RegistryImportState | null = initial
    ? {
        imports: [],
        changesets: [],
        ...initial
      }
    : null;

  const store: RegistryImportStore & { snapshot: () => RegistryImportState | null } = {
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

function skill(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: "skill_imported_brief",
    tenantId: "tenant_demo",
    kind: "skill",
    name: "Imported Brief Skill",
    slug: "imported-brief-skill",
    description: "Creates a source-backed operating brief.",
    tier: "team",
    ownerId: "usr_admin",
    version: "0.1.0",
    status: "draft",
    permissions: ["brain:read"],
    dependencies: ["atom_001"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    skillMarkdown: "# Imported Brief Skill\n\nUse governed memory only.",
    evals: ["must cite source atoms"],
    examples: ["Create a brief for onboarding."],
    changelog: ["Initial import."],
    rollbackTarget: "0.0.0",
    ...overrides
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("registry package import", () => {
  it("imports a valid skill as a draft registry changeset with preview metadata", async () => {
    const service = createRegistryImportService({
      store: createStore(),
      registryItems: registry,
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const result = await service.importPackage(skill(), { principalId: "usr_admin" });

    expect(result.importRecord).toMatchObject({
      status: "draft",
      packageKind: "skill",
      slug: "imported-brief-skill",
      version: "0.1.0"
    });
    expect(result.changeset).toMatchObject({
      targetType: "skill",
      status: "draft",
      ownerId: "usr_admin"
    });
    expect(result.preview).toMatchObject({
      dependencyGraph: ["atom_001", "tool_brain_query"],
      requiredPermissions: ["brain:read"],
      targetAdapters: ["codex", "claude-code", "generic-mcp"]
    });
  });

  it("returns actionable validation errors for malformed manifests", async () => {
    const service = createRegistryImportService({ store: createStore(), registryItems: registry });

    await expect(service.importPackage({ slug: "bad-package" }, { principalId: "usr_admin" })).rejects.toThrow(
      /kind|owner|version/i
    );
  });

  it("rejects packages without owners", async () => {
    const service = createRegistryImportService({ store: createStore(), registryItems: registry });

    await expect(service.importPackage(skill({ ownerId: "" }), { principalId: "usr_admin" })).rejects.toThrow(/owner/i);
  });

  it("reports dependency mismatch and missing required tools", async () => {
    const service = createRegistryImportService({ store: createStore(), registryItems: registry });

    await expect(
      service.importPackage(
        skill({
          dependencies: ["missing_atom"],
          requiredTools: ["missing_tool"]
        }),
        { principalId: "usr_admin" }
      )
    ).rejects.toThrow(/missing_atom|missing_tool/i);
  });

  it("rejects duplicate package kind, slug, and version imports", async () => {
    const service = createRegistryImportService({ store: createStore(), registryItems: registry });

    await service.importPackage(skill(), { principalId: "usr_admin" });

    await expect(service.importPackage(skill(), { principalId: "usr_admin" })).rejects.toThrow(/duplicate/i);
  });

  it("imports and lists packages through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-registry-import-"));
    process.env.REGISTRY_IMPORT_STATE_PATH = join(dir, "imports.json");
    process.env.COMPANY_BRAIN_REPOSITORY = "seed";
    vi.resetModules();
    const [importRoute, listRoute] = await Promise.all([
      import("../app/api/v1/registry/import/route"),
      import("../app/api/v1/registry/imports/route")
    ]);

    const response = await importRoute.POST(jsonRequest("/api/v1/registry/import", { package: skill() }));
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.importRecord.status).toBe("draft");

    const listResponse = await listRoute.GET();
    const list = await listResponse.json();
    expect(list.imports).toHaveLength(1);
  });
});
