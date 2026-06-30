import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRegistryMaintenanceAgent, type RegistryMaintenanceState, type RegistryMaintenanceStore } from "../lib/registry-maintenance-agent";
import type { Principal, RegistryItem, SkillPackage, ToolDefinition } from "../lib/types";

const principal: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["registry:review", "registry:publish"]
};

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tool_slack_send",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Slack Send",
    slug: "slack-send",
    description: "Send Slack through Composio.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["composio:slack:execute"],
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

function skill(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: "skill_notify",
    tenantId: "tenant_demo",
    kind: "skill",
    name: "Notify Skill",
    slug: "notify-skill",
    description: "Uses Slack and policy memory.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["brain:read"],
    dependencies: ["atom_policy", "tool_slack_send"],
    requiredTools: ["tool_slack_send"],
    adapterTargets: ["codex", "generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    skillMarkdown: "# Notify Skill",
    evals: ["eval.yml"],
    examples: ["Notify the team."],
    changelog: ["1.0.0"],
    rollbackTarget: "0.9.0",
    ...overrides
  };
}

function createStore() {
  let state: RegistryMaintenanceState | null = null;
  const store: RegistryMaintenanceStore & { snapshot: () => RegistryMaintenanceState | null } = {
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

describe("registry maintenance agent", () => {
  it("flags dependent packages when a dependency changes", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [tool(), skill()] });

    const result = await agent.scan({ principal, dependencyChanges: [{ dependencyId: "tool_slack_send", changeType: "schema-changed" }] });

    expect(result.findings.map((finding) => finding.action)).toContain("review-dependency");
    expect(result.changesets[0]).toMatchObject({ targetId: "skill_notify", targetType: "skill" });
    expect(result.changesets[0]?.summary).toMatch(/tool_slack_send/);
  });

  it("flags policy atom dependents when policy memory changes", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [tool(), skill()] });

    const result = await agent.scan({ principal, policyChanges: [{ atomId: "atom_policy", policyType: "tool-safety" }] });

    expect(result.findings[0]).toMatchObject({ action: "review-policy-impact", packageId: "skill_notify" });
  });

  it("flags Composio action removal for connector tools and dependents", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [tool(), skill()] });

    const result = await agent.scan({ principal, composioChanges: [{ toolkitSlug: "slack", removedActions: ["slack-send"] }] });

    expect(result.findings.map((finding) => finding.packageId)).toEqual(expect.arrayContaining(["tool_slack_send", "skill_notify"]));
    expect(result.findings.map((finding) => finding.action)).toContain("replace-removed-tool");
  });

  it("flags dependents of deprecated tools", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [tool({ status: "deprecated" }), skill()] });

    const result = await agent.scan({ principal });

    expect(result.findings[0]).toMatchObject({ action: "review-dependency", packageId: "skill_notify" });
    expect(result.findings[0]?.evidence).toContain("deprecated-tool:tool_slack_send");
    expect(result.changesets[0]?.summary).toMatch(/deprecated/i);
  });

  it("opens risky adapter review and pauses for owner approval", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [skill({ permissions: ["vendor:unknown"] })] });

    const result = await agent.scan({ principal, requireApprovalForRisky: true });

    expect(result.findings[0]).toMatchObject({ action: "fix-adapter" });
    expect(result.approvals[0]?.reviewerContext).toMatch(/Unsupported permission mapping/i);
    expect(result.changesets).toHaveLength(0);
  });

  it("flags low usage and rollback risk", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [tool(), skill()] });

    const result = await agent.scan({
      principal,
      usage: { skill_notify: { previous: 50, current: 10 } },
      rollbackRisk: { skill_notify: 88 }
    });

    expect(result.findings.map((finding) => finding.action)).toEqual(expect.arrayContaining(["review-usage", "review-rollback-risk"]));
    expect(result.findings.find((finding) => finding.action === "review-usage")?.evidence).toContain("usage:50->10");
    expect(result.findings.find((finding) => finding.action === "review-rollback-risk")?.risk).toBe("high");
  });

  it("prevents duplicate open review changesets", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [tool(), skill()] });
    const input = { principal, dependencyChanges: [{ dependencyId: "tool_slack_send", changeType: "schema-changed" }] };

    const first = await agent.scan(input);
    const second = await agent.scan(input);

    expect(first.changesets).toHaveLength(1);
    expect(second.changesets).toHaveLength(0);
    expect(second.duplicatesSuppressed).toBe(1);
  });

  it("prevents duplicate pending approval reviews", async () => {
    const agent = createRegistryMaintenanceAgent({ store: createStore(), registryItems: [skill({ permissions: ["vendor:unknown"] })] });

    const first = await agent.scan({ principal, requireApprovalForRisky: true });
    const second = await agent.scan({ principal, requireApprovalForRisky: true });

    expect(first.approvals).toHaveLength(1);
    expect(second.approvals).toHaveLength(0);
    expect(second.duplicatesSuppressed).toBe(1);
  });

  it("serves scan and status through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-registry-maintenance-"));
    process.env.REGISTRY_MAINTENANCE_STATE_PATH = join(dir, "maintenance.json");
    vi.resetModules();
    const scanRoute = await import("../app/api/v1/registry-maintenance/scan/route");
    const statusRoute = await import("../app/api/v1/registry-maintenance/status/route");

    const response = await scanRoute.POST(
      jsonRequest("/api/v1/registry-maintenance/scan", {
        principal,
        registryItems: [tool(), skill()],
        dependencyChanges: [{ dependencyId: "tool_slack_send", changeType: "schema-changed" }]
      })
    );
    const payload = await response.json();
    const status = await statusRoute.GET();
    const state = await status.json();

    expect(response.status).toBe(200);
    expect(payload.findings.length).toBeGreaterThan(0);
    expect(state.scans).toHaveLength(1);
  });
});
