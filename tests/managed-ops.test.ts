import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createManagedOpsService, type ManagedOpsState, type ManagedOpsStore } from "../lib/managed-ops";
import type { Principal } from "../lib/types";

const supportAdmin: Principal = {
  id: "usr_support",
  name: "Support Admin",
  email: "support@example.com",
  role: "admin",
  teams: ["support"],
  tiers: ["individual", "team", "company-main"],
  scopes: ["support:read", "audit:read"]
};

const tenantAdmin: Principal = {
  id: "usr_tenant_admin",
  name: "Tenant Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "company-main"],
  scopes: ["tenant:tenant_acme_ai:admin", "audit:read"]
};

const outsider: Principal = {
  id: "usr_outsider",
  name: "Outsider",
  email: "outsider@example.com",
  role: "employee",
  teams: ["sales"],
  tiers: ["individual"],
  scopes: ["brain:read"]
};

function memoryStore(initial?: Partial<ManagedOpsState>) {
  let state: ManagedOpsState | null = initial
    ? {
        usageEvents: [],
        usageSummaries: [],
        alerts: [],
        supportViews: [],
        workerRecoveries: [],
        upgradePlans: [],
        auditEvents: [],
        ...initial
      }
    : null;
  const store: ManagedOpsStore & { snapshot: () => ManagedOpsState | null } = {
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

describe("managed ops service", () => {
  it("records usage and costs by tenant", async () => {
    const service = createManagedOpsService({ store: memoryStore(), now: () => "2026-06-30T09:00:00.000Z" });

    const result = await service.recordUsage({
      principal: tenantAdmin,
      tenantId: "tenant_acme_ai",
      measurements: {
        connectorSyncs: 12,
        composioActions: 18,
        toolInvocations: 7,
        storageBytes: 2_000_000,
        queryCount: 31,
        cronRuns: 4,
        workerMs: 90_000
      }
    });

    expect(result.summary.usage).toMatchObject({
      connectorSyncs: 12,
      composioActions: 18,
      toolInvocations: 7,
      storageBytes: 2_000_000,
      queryCount: 31,
      cronRuns: 4,
      workerMs: 90_000
    });
    expect(result.summary.costUsd).toBeGreaterThan(0);
    expect(result.auditEvent.action).toBe("managed-ops.usage.record");
  });

  it("blocks plan-limit overflow before runaway connector or cron usage", async () => {
    const service = createManagedOpsService({
      store: memoryStore(),
      now: () => "2026-06-30T09:00:00.000Z",
      planLimits: { team: { connectorSyncs: 10, composioActions: 20, toolInvocations: 20, storageBytes: 5_000_000, queryCount: 100, cronRuns: 2, workerMs: 120_000, budgetUsd: 1 } }
    });
    await service.recordUsage({ principal: tenantAdmin, tenantId: "tenant_acme_ai", plan: "team", measurements: { connectorSyncs: 9, cronRuns: 2 } });

    const decision = await service.enforcePlanLimit({ principal: tenantAdmin, tenantId: "tenant_acme_ai", plan: "team", requested: { connectorSyncs: 2, cronRuns: 1 } });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/connectorSyncs|cronRuns/);
    expect(decision.alerts.map((alert) => alert.kind)).toEqual(expect.arrayContaining(["plan-limit"]));
  });

  it("returns tenant-isolated support diagnostics without secrets or restricted source content", async () => {
    const service = createManagedOpsService({ store: memoryStore(), now: () => "2026-06-30T09:00:00.000Z" });
    await service.recordUsage({ principal: tenantAdmin, tenantId: "tenant_acme_ai", measurements: { connectorSyncs: 1, storageBytes: 1000 } });
    await service.recordWorkerFailure({
      principal: tenantAdmin,
      tenantId: "tenant_acme_ai",
      workerId: "worker_secret",
      role: "connector",
      error: "failed on secret://tenant_acme_ai/DATABASE_URL with restricted text customer ssn",
      checkpointIds: ["slack:acct_slack"]
    });

    const view = await service.supportView({ principal: supportAdmin, tenantId: "tenant_acme_ai" });
    const denied = await service.supportView({ principal: outsider, tenantId: "tenant_acme_ai" });

    expect(view.view.status).toBe("available");
    expect(JSON.stringify(view.view)).not.toContain("secret://");
    expect(JSON.stringify(view.view)).not.toMatch(/customer ssn/i);
    expect(denied.view.status).toBe("denied");
    expect(denied.auditEvent.policyDecision).toBe("deny");
  });

  it("records failed worker recovery with checkpoint replay and lease cleanup guidance", async () => {
    const service = createManagedOpsService({ store: memoryStore(), now: () => "2026-06-30T09:00:00.000Z" });

    const recovery = await service.recordWorkerFailure({
      principal: tenantAdmin,
      tenantId: "tenant_acme_ai",
      workerId: "worker_connector_1",
      role: "connector",
      error: "timeout while syncing Slack",
      checkpointIds: ["slack:acct_slack"],
      leaseIds: ["lease_1"]
    });

    expect(recovery.record.status).toBe("recovery-ready");
    expect(recovery.record.recoverySteps).toEqual(expect.arrayContaining(["release scheduler lease lease_1", "restart connector worker worker_connector_1"]));
    expect(recovery.record.replayPlan).toEqual(["POST /api/v1/connectors/replay for checkpoint slack:acct_slack"]);
  });

  it("plans managed upgrade replay while preserving checkpoints, cron schedules, and package versions", async () => {
    const service = createManagedOpsService({ store: memoryStore(), now: () => "2026-06-30T09:00:00.000Z" });

    const plan = await service.planUpgrade({
      principal: tenantAdmin,
      tenantId: "tenant_acme_ai",
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      connectorCheckpoints: ["slack:acct_slack:cursor_10"],
      cronSchedules: ["cron_health:*/30 * * * *"],
      packageVersions: ["sales-followup@1.0.0"]
    });

    expect(plan.record.status).toBe("planned");
    expect(plan.record.preserved.connectorCheckpoints).toEqual(["slack:acct_slack:cursor_10"]);
    expect(plan.record.preserved.cronSchedules).toEqual(["cron_health:*/30 * * * *"]);
    expect(plan.record.preserved.packageVersions).toEqual(["sales-followup@1.0.0"]);
    expect(plan.record.replaySteps).toEqual(expect.arrayContaining(["replay connector checkpoint slack:acct_slack:cursor_10"]));
  });

  it("serves usage, limit checks, support view, worker recovery, upgrade planning, and status routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-managed-ops-"));
    process.env.MANAGED_OPS_STATE_PATH = join(dir, "managed-ops.json");
    vi.resetModules();

    const usageRoute = await import("../app/api/v1/managed-ops/usage/route");
    const limitsRoute = await import("../app/api/v1/managed-ops/limits/check/route");
    const supportRoute = await import("../app/api/v1/managed-ops/support/[tenantId]/route");
    const workerRoute = await import("../app/api/v1/managed-ops/workers/recover/route");
    const upgradeRoute = await import("../app/api/v1/managed-ops/upgrades/plan/route");
    const statusRoute = await import("../app/api/v1/managed-ops/status/route");

    const usage = await usageRoute.POST(jsonRequest("/api/v1/managed-ops/usage", { principal: tenantAdmin, tenantId: "tenant_acme_ai", measurements: { connectorSyncs: 3, queryCount: 10 } }));
    expect(usage.status).toBe(200);

    const limit = await limitsRoute.POST(jsonRequest("/api/v1/managed-ops/limits/check", { principal: tenantAdmin, tenantId: "tenant_acme_ai", requested: { connectorSyncs: 1 } }));
    expect(limit.status).toBe(200);

    const worker = await workerRoute.POST(jsonRequest("/api/v1/managed-ops/workers/recover", { principal: tenantAdmin, tenantId: "tenant_acme_ai", workerId: "worker_api", role: "scheduler", error: "timeout", checkpointIds: ["github:acct"] }));
    expect(worker.status).toBe(200);

    const upgrade = await upgradeRoute.POST(
      jsonRequest("/api/v1/managed-ops/upgrades/plan", {
        principal: tenantAdmin,
        tenantId: "tenant_acme_ai",
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        connectorCheckpoints: ["github:acct:cursor"],
        cronSchedules: ["cron:0 * * * *"],
        packageVersions: ["pkg@1.0.0"]
      })
    );
    expect(upgrade.status).toBe(200);

    const support = await supportRoute.GET(new Request("http://localhost/api/v1/managed-ops/support/tenant_acme_ai"), {
      params: Promise.resolve({ tenantId: "tenant_acme_ai" })
    });
    expect(support.status).toBe(200);

    const state = await statusRoute.GET();
    const body = await state.json();
    expect(body.usageEvents).toHaveLength(1);
    expect(body.workerRecoveries).toHaveLength(1);
    expect(body.upgradePlans).toHaveLength(1);
  });
});
