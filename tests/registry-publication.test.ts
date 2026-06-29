import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRegistryPublicationPipeline, type RegistryPublicationState, type RegistryPublicationStore } from "../lib/registry-publication";
import type { Changeset, RegistryItem, SkillPackage, ToolDefinition } from "../lib/types";

function createStore(initial?: Partial<RegistryPublicationState>) {
  let state: RegistryPublicationState | null = initial
    ? {
        checks: [],
        publications: [],
        auditEvents: [],
        ...initial
      }
    : null;
  const store: RegistryPublicationStore & { snapshot: () => RegistryPublicationState | null } = {
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
    id: "skill_publish",
    tenantId: "tenant_demo",
    kind: "skill",
    name: "Publish Skill",
    slug: "publish-skill",
    description: "A package ready for gated publication.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "approved",
    permissions: ["brain:read"],
    dependencies: ["atom_001"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    skillMarkdown: "# Publish Skill\n\nUse source-backed memory.",
    evals: ["passes citation eval"],
    examples: ["Create a brief."],
    changelog: ["Ready for publication."],
    rollbackTarget: "0.9.0",
    ...overrides
  };
}

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tool_publish",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Publish Tool",
    slug: "publish-tool",
    description: "A governed connector tool.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "approved",
    permissions: ["composio:slack:read"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    toolType: "connector",
    inputSchema: {},
    rateLimit: "60/minute",
    secrets: [],
    auditPolicy: "log-metadata",
    ...overrides
  };
}

function changeset(item: RegistryItem = skill()): Changeset {
  return {
    id: "cs_publish",
    tenantId: item.tenantId,
    title: `Publish ${item.slug}`,
    targetType: item.kind,
    targetId: item.id,
    tier: item.tier,
    authorId: "usr_admin",
    ownerId: item.ownerId,
    reviewers: ["usr_reviewer"],
    status: "approved",
    checks: [],
    summary: "Publication review approved.",
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z"
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("registry publication gate", () => {
  it("blocks publication when skill evals are missing", async () => {
    const pipeline = createRegistryPublicationPipeline({ store: createStore() });
    const result = await pipeline.evaluate({ item: skill({ evals: [] }), changeset: changeset() });

    expect(result.decision.allowed).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: "evals", status: "failed" })]));
  });

  it("blocks unsafe permissions and exposed secrets", async () => {
    const pipeline = createRegistryPublicationPipeline({ store: createStore() });
    const unsafeTool = tool({
      permissions: ["composio:slack:write"],
      secrets: ["plain-secret-value"],
      auditPolicy: "restricted"
    });
    const result = await pipeline.evaluate({ item: unsafeTool, changeset: changeset(unsafeTool) });

    expect(result.decision.allowed).toBe(false);
    expect(result.checks.find((check) => check.id === "security")?.detail).toMatch(/write|secret|audit/i);
  });

  it("fails adapter generation when adapter targets are missing", async () => {
    const pipeline = createRegistryPublicationPipeline({ store: createStore() });
    const result = await pipeline.evaluate({ item: skill({ adapterTargets: [] }), changeset: changeset() });

    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: "adapters", status: "failed" })]));
  });

  it("blocks publish without reviewer context", async () => {
    const pipeline = createRegistryPublicationPipeline({ store: createStore() });
    const item = skill();
    await pipeline.evaluate({ item, changeset: changeset(item) });

    const result = await pipeline.publish({ item, changeset: changeset(item) });

    expect(result.published).toBe(false);
    expect(result.decision.reasons.join(" ")).toMatch(/reviewer/i);
  });

  it("publishes when checks pass and stores rollback metadata", async () => {
    const pipeline = createRegistryPublicationPipeline({ store: createStore(), now: () => "2026-06-29T10:00:00.000Z" });
    const item = skill();
    const result = await pipeline.publish({ item, changeset: changeset(item), reviewerId: "usr_reviewer" });

    expect(result.published).toBe(true);
    expect(result.publication).toMatchObject({
      packageId: "skill_publish",
      version: "1.0.0",
      rollbackTarget: "0.9.0",
      canaryPercent: 10
    });
    expect(result.auditEvent).toMatchObject({
      action: "registry.publish",
      actorId: "usr_reviewer"
    });
  });

  it("publishes through API route", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-publication-"));
    process.env.REGISTRY_PUBLICATION_STATE_PATH = join(dir, "publication.json");
    vi.resetModules();
    const publishRoute = await import("../app/api/v1/registry/publication/publish/route");

    const response = await publishRoute.POST(
      jsonRequest("/api/v1/registry/publication/publish", {
        item: skill(),
        changeset: changeset(),
        reviewerId: "usr_reviewer"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.published).toBe(true);
  });
});
