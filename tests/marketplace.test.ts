import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createMarketplaceService,
  type MarketplaceState,
  type MarketplaceStore,
  type MarketplacePackage
} from "../lib/marketplace";
import type { Principal, SkillPackage, ToolDefinition } from "../lib/types";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["registry:read", "registry:install", "registry:publish", "audit:read"]
};

const reviewer: Principal = {
  ...admin,
  id: "usr_reviewer",
  role: "reviewer",
  scopes: ["registry:read", "registry:review", "registry:install", "audit:read"]
};

function tool(): ToolDefinition {
  return {
    id: "tool_marketplace_query",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Marketplace Query",
    slug: "marketplace-query",
    description: "Query local brain context.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["brain:read"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-30T08:00:00.000Z",
    toolType: "mcp",
    inputSchema: {},
    rateLimit: "120/minute",
    secrets: [],
    auditPolicy: "log-metadata"
  };
}

function skill(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: "skill_private_operator",
    tenantId: "tenant_demo",
    kind: "skill",
    name: "Private Operator Skill",
    slug: "private-operator-skill",
    description: "Private skill used by platform operators.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.2.0",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["atom_001"],
    requiredTools: ["tool_marketplace_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-30T08:00:00.000Z",
    skillMarkdown: "# Private Operator Skill\n\nUse governed memory.",
    evals: ["evals/private/operator.yml"],
    examples: ["Summarize operator state."],
    changelog: ["1.2.0: Added OpenCode adapter."],
    rollbackTarget: "1.1.0",
    ...overrides
  };
}

function publicPackage(overrides: Partial<MarketplacePackage> = {}): MarketplacePackage {
  const manifest = skill({
    id: "skill_public_setup",
    tenantId: "marketplace_public",
    name: "Public Setup Skill",
    slug: "public-setup-skill",
    version: "0.4.0",
    tier: "team",
    ownerId: "community_ai_native",
    status: "published",
    dependencies: ["atom_001"],
    requiredTools: ["tool_marketplace_query"],
    permissions: ["brain:read", "registry:read"],
    changelog: ["0.4.0: Added Composio setup checklist."],
    rollbackTarget: "0.3.0"
  });

  return {
    source: "public",
    owner: "AI Native Community",
    installCount: 128,
    manifest,
    trust: {
      signatureStatus: "valid",
      provenance: {
        publisher: "AI Native Community",
        sourceUrl: "https://marketplace.example.com/public-setup-skill",
        digest: "sha256:public-setup"
      },
      security: {
        status: "passed",
        scanId: "scan_public_setup",
        findings: []
      },
      evalResults: {
        status: "passed",
        passRate: 0.96,
        suites: ["grounding", "acl", "adapter"]
      }
    },
    ...overrides
  };
}

function dependentPublicPackage(): MarketplacePackage {
  return publicPackage({
    owner: "AI Native Community",
    installCount: 24,
    manifest: skill({
      id: "skill_public_dependency",
      tenantId: "marketplace_public",
      name: "Public Dependency Skill",
      slug: "public-dependency-skill",
      version: "0.1.0",
      ownerId: "community_ai_native",
      dependencies: ["atom_001"],
      requiredTools: ["tool_marketplace_query"],
      changelog: ["0.1.0: Initial dependency package."],
      rollbackTarget: "0.0.0"
    })
  });
}

function createStore(initial?: Partial<MarketplaceState>) {
  let state: MarketplaceState | null = initial
    ? {
        installs: [],
        reviews: [],
        rollbacks: [],
        auditEvents: [],
        ...initial
      }
    : null;

  const store: MarketplaceStore & { snapshot: () => MarketplaceState | null } = {
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

describe("private/public package marketplace", () => {
  it("lists private and public packages with trust, compatibility, security, evals, install count, and changelog", async () => {
    const service = createMarketplaceService({
      store: createStore(),
      registryItems: [skill(), tool()],
      publicPackages: [publicPackage()]
    });

    const catalog = await service.listMarketplace({ principal: admin });
    const privateListing = catalog.packages.find((item) => item.slug === "private-operator-skill");
    const publicListing = catalog.packages.find((item) => item.slug === "public-setup-skill");

    expect(privateListing).toMatchObject({
      source: "private",
      owner: "usr_admin",
      version: "1.2.0",
      securityStatus: "passed",
      installCount: 0
    });
    expect(privateListing?.compatibleAgents).toEqual(["codex", "claude-code", "opencode", "generic-mcp"]);
    expect(privateListing?.changelog).toContain("1.2.0: Added OpenCode adapter.");
    expect(publicListing).toMatchObject({
      source: "public",
      owner: "AI Native Community",
      version: "0.4.0",
      securityStatus: "passed",
      installCount: 128
    });
    expect(publicListing?.trust.provenance.sourceUrl).toContain("marketplace.example.com");
    expect(publicListing?.evalResults.passRate).toBe(0.96);
    expect(publicListing?.permissionSummary).toContain("brain:read");
  });

  it("opens local registry changesets when installing private and public packages", async () => {
    const store = createStore();
    const service = createMarketplaceService({
      store,
      registryItems: [skill(), tool()],
      publicPackages: [publicPackage()],
      now: () => "2026-06-30T08:00:00.000Z",
      id: (prefix) => `${prefix}_1`
    });

    const privateInstall = await service.installPackage({
      principal: admin,
      packageId: "private-operator-skill",
      targetTier: "team"
    });
    const publicInstall = await service.installPackage({
      principal: admin,
      packageId: "public-setup-skill",
      targetTier: "department"
    });

    expect(privateInstall.changeset.status).toBe("draft");
    expect(privateInstall.changeset.summary).toMatch(/marketplace install/i);
    expect(privateInstall.package.status).toBe("published");
    expect(publicInstall.changeset).toMatchObject({
      targetType: "skill",
      targetId: "skill_public_setup",
      tier: "department",
      status: "draft"
    });
    expect(store.snapshot()?.installs).toHaveLength(2);
    expect(store.snapshot()?.installs.every((install) => install.published === false)).toBe(true);
  });

  it("records reviewer decisions with visible signature, provenance, dependency, and permission evidence", async () => {
    const store = createStore();
    const service = createMarketplaceService({
      store,
      registryItems: [tool()],
      publicPackages: [publicPackage()],
      now: () => "2026-06-30T08:00:00.000Z"
    });

    const review = await service.reviewPackage({
      principal: reviewer,
      packageId: "public-setup-skill"
    });

    expect(review.review.decision).toBe("approved-for-install");
    expect(review.review.evidence.signatureStatus).toBe("valid");
    expect(review.review.evidence.provenance.publisher).toBe("AI Native Community");
    expect(review.review.evidence.dependencies.resolved).toContain("tool_marketplace_query");
    expect(review.review.evidence.permissions).toEqual(["brain:read", "registry:read"]);
    expect(store.snapshot()?.reviews[0]?.packageSlug).toBe("public-setup-skill");
  });

  it("blocks unsafe public packages before creating install changesets", async () => {
    const store = createStore();
    const unsafe = publicPackage({
      manifest: skill({
        id: "skill_unsafe_shell",
        slug: "unsafe-shell-skill",
        name: "Unsafe Shell Skill",
        permissions: ["shell:write", "secrets:read"]
      }),
      trust: {
        ...publicPackage().trust,
        signatureStatus: "invalid",
        security: {
          status: "blocked",
          scanId: "scan_unsafe_shell",
          findings: ["Requests shell write and secret read access."]
        }
      }
    });
    const service = createMarketplaceService({
      store,
      registryItems: [tool()],
      publicPackages: [unsafe],
      now: () => "2026-06-30T08:00:00.000Z"
    });

    await expect(
      service.installPackage({
        principal: admin,
        packageId: "unsafe-shell-skill",
        targetTier: "team"
      })
    ).rejects.toThrow(/blocked|signature|permission/i);

    expect(store.snapshot()?.installs ?? []).toHaveLength(0);
    expect(store.snapshot()?.auditEvents[0]).toMatchObject({
      action: "marketplace.install.block",
      policyDecision: "deny"
    });
  });

  it("stages missing public dependencies with the requested package", async () => {
    const dependency = dependentPublicPackage();
    const app = publicPackage({
      manifest: skill({
        id: "skill_public_app",
        name: "Public App Skill",
        slug: "public-app-skill",
        dependencies: ["public-dependency-skill"],
        requiredTools: ["tool_marketplace_query"]
      })
    });
    const service = createMarketplaceService({
      store: createStore(),
      registryItems: [tool()],
      publicPackages: [app, dependency],
      now: () => "2026-06-30T08:00:00.000Z"
    });

    const install = await service.installPackage({
      principal: admin,
      packageId: "public-app-skill",
      targetTier: "team",
      includeDependencies: true
    });

    expect(install.dependencyChangesets.map((changeset) => changeset.targetId)).toContain("skill_public_dependency");
    expect(install.dependencyPlan.missing).toEqual(["public-dependency-skill"]);
    expect(install.dependencyPlan.staged).toEqual(["public-dependency-skill"]);
  });

  it("creates an audited rollback changeset after marketplace install", async () => {
    const store = createStore();
    const service = createMarketplaceService({
      store,
      registryItems: [skill(), tool()],
      publicPackages: [publicPackage()],
      now: () => "2026-06-30T08:00:00.000Z",
      id: (prefix) => `${prefix}_rollback`
    });

    const install = await service.installPackage({
      principal: admin,
      packageId: "public-setup-skill",
      targetTier: "team"
    });
    const rollback = await service.rollbackInstall({
      principal: admin,
      installId: install.install.id,
      reason: "Eval regression after install."
    });

    expect(rollback.rollback.changeset).toMatchObject({
      status: "approved",
      targetId: "skill_public_setup"
    });
    expect(rollback.rollback.auditEvent).toMatchObject({
      action: "marketplace.install.rollback",
      policyDecision: "allow"
    });
    expect(store.snapshot()?.rollbacks[0]?.reason).toMatch(/Eval regression/);
  });

  it("serves marketplace list, review, install, rollback, and export compatibility through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-marketplace-"));
    process.env.MARKETPLACE_STATE_PATH = join(dir, "marketplace.json");
    process.env.COMPANY_BRAIN_TENANT_ID = "tenant_demo";
    vi.resetModules();
    const [statusRoute, listRoute, reviewRoute, installRoute, rollbackRoute, exportRoute] = await Promise.all([
      import("../app/api/v1/registry/marketplace/status/route"),
      import("../app/api/v1/registry/marketplace/route"),
      import("../app/api/v1/registry/marketplace/review/route"),
      import("../app/api/v1/registry/marketplace/install/route"),
      import("../app/api/v1/registry/marketplace/rollback/route"),
      import("../app/api/v1/registry/marketplace/export/route")
    ]);

    const listResponse = await listRoute.GET(new Request("http://localhost/api/v1/registry/marketplace?principalId=usr_admin"));
    const listPayload = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listPayload.packages.some((item: { source: string }) => item.source === "public")).toBe(true);

    const reviewResponse = await reviewRoute.POST(jsonRequest("/api/v1/registry/marketplace/review", { principalId: "usr_reviewer", packageId: "public-sales-followup" }));
    const reviewPayload = await reviewResponse.json();
    expect(reviewResponse.status).toBe(200);
    expect(reviewPayload.review.evidence.signatureStatus).toBe("valid");

    const installResponse = await installRoute.POST(
      jsonRequest("/api/v1/registry/marketplace/install", {
        principalId: "usr_admin",
        packageId: "public-sales-followup",
        targetTier: "team",
        includeDependencies: true
      })
    );
    const installPayload = await installResponse.json();
    expect(installResponse.status).toBe(201);
    expect(installPayload.changeset.status).toBe("draft");

    const exportResponse = await exportRoute.POST(jsonRequest("/api/v1/registry/marketplace/export", { packageId: "public-sales-followup" }));
    const exportPayload = await exportResponse.json();
    expect(exportResponse.status).toBe(200);
    expect(exportPayload.format).toBe("registry-package/v1");
    expect(exportPayload.compatibility).toMatchObject({ cloud: true, selfHost: true });

    const rollbackResponse = await rollbackRoute.POST(
      jsonRequest("/api/v1/registry/marketplace/rollback", {
        principalId: "usr_admin",
        installId: installPayload.install.id,
        reason: "Testing rollback path."
      })
    );
    const rollbackPayload = await rollbackResponse.json();
    expect(rollbackResponse.status).toBe(200);
    expect(rollbackPayload.rollback.changeset.status).toBe("approved");

    const statusResponse = await statusRoute.GET();
    const statusPayload = await statusResponse.json();
    expect(statusPayload.installs).toHaveLength(1);
    expect(statusPayload.rollbacks).toHaveLength(1);
  });
});
