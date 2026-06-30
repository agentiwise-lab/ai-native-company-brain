import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOperabilityService, type OperabilityState, type OperabilityStore } from "../lib/operability";
import type { BrainRepository } from "../lib/repository-contract";
import type { BrainEvent, DashboardSnapshot, KnowledgeAtom, Principal } from "../lib/types";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "brain:write", "audit:read"]
};

const employee: Principal = {
  id: "usr_employee",
  name: "Employee",
  email: "employee@example.com",
  role: "employee",
  teams: ["platform"],
  tiers: ["individual", "team"],
  scopes: ["brain:read"]
};

function memoryStore(initial?: Partial<OperabilityState>) {
  let state: OperabilityState | null = initial
    ? {
        telemetryEvents: [],
        healthSnapshots: [],
        backups: [],
        restores: [],
        migrationRecoveries: [],
        auditEvents: [],
        ...initial
      }
    : null;
  const store: OperabilityStore & { snapshot: () => OperabilityState | null } = {
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

function atom(): KnowledgeAtom {
  return {
    id: "atom_ops",
    tenantId: "tenant_demo",
    title: "Operate the brain",
    body: "Operators watch health, backups, migrations, and connector replay.",
    atomType: "procedure",
    tier: "company-main",
    ownerId: "usr_admin",
    sourceIds: ["src_ops"],
    acl: { teams: ["platform"], roles: ["admin", "reviewer"], sensitivity: "internal" },
    status: "approved",
    version: 1,
    confidence: 0.9,
    freshness: 0.9,
    reviewDueAt: "2026-07-30T00:00:00.000Z",
    createdAt: "2026-06-30T07:00:00.000Z",
    updatedAt: "2026-06-30T07:00:00.000Z",
    tags: ["ops"]
  };
}

function event(overrides: Partial<BrainEvent> = {}): BrainEvent {
  return {
    id: "evt_ops",
    tenantId: "tenant_demo",
    actorId: "usr_admin",
    action: "answer",
    targetId: "atom_ops",
    targetType: "atom",
    policyDecision: "allow",
    metadata: { sourceIds: ["src_ops"] },
    createdAt: "2026-06-30T07:15:00.000Z",
    ...overrides
  };
}

function dashboard(): DashboardSnapshot {
  return {
    principal: admin,
    tiers: [],
    atoms: [atom()],
    registry: [],
    changesets: [],
    cronRuns: [
      {
        id: "run_ops",
        cronJobId: "cron_ops",
        status: "succeeded",
        startedAt: "2026-06-30T07:20:00.000Z",
        finishedAt: "2026-06-30T07:20:03.000Z",
        durationMs: 3000,
        output: "Ops check complete.",
        auditEventIds: ["evt_ops"]
      }
    ],
    qualityScores: [],
    events: [event()]
  };
}

function repository(): BrainRepository {
  return {
    dashboard: vi.fn(async () => dashboard()),
    principal: vi.fn(async (id?: string) => (id === "usr_employee" ? employee : admin)),
    queryBrain: vi.fn(),
    commitBrain: vi.fn(),
    lineage: vi.fn(),
    listChangesets: vi.fn(),
    reviewMemoryChangeset: vi.fn(),
    mergeMemoryChangeset: vi.fn(),
    searchRegistry: vi.fn(),
    createRegistryChangeset: vi.fn(),
    publishRegistryItem: vi.fn(),
    rollbackRegistryItem: vi.fn(),
    listCronJobs: vi.fn(),
    getCronJob: vi.fn(),
    runCronJob: vi.fn(),
    listCronRuns: vi.fn(),
    allRegistry: vi.fn(async () => []),
    allEvents: vi.fn(async () => [event(), event({ id: "evt_scheduler", action: "cron.run", targetId: "run_ops", targetType: "cron-run" })])
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("operability service", () => {
  it("records logs, metrics, and traces for core surfaces", async () => {
    const store = memoryStore();
    const service = createOperabilityService({ store, repository: repository(), now: () => "2026-06-30T08:00:00.000Z" });

    await service.recordTelemetry({ component: "app", type: "log", severity: "info", message: "request completed" });
    await service.recordTelemetry({ component: "queue", type: "metric", name: "queue_depth", value: 42 });
    await service.recordTelemetry({ component: "mcp", type: "trace", traceId: "trace_mcp", durationMs: 91, message: "audit.trace" });

    expect(store.snapshot()?.telemetryEvents).toHaveLength(3);
    expect(store.snapshot()?.telemetryEvents.map((item) => item.component)).toEqual(["mcp", "queue", "app"]);
  });

  it("collects worker health and raises queue-depth alerts", async () => {
    const service = createOperabilityService({ store: memoryStore(), repository: repository(), now: () => "2026-06-30T08:00:00.000Z" });

    const result = await service.collectHealth({
      principal: admin,
      queueDepth: 1200,
      queueDepthThreshold: 500,
      workers: [
        { id: "worker_fresh", role: "scheduler", lastHeartbeatAt: "2026-06-30T07:59:00.000Z", activeLeases: 1 },
        { id: "worker_stale", role: "connector", lastHeartbeatAt: "2026-06-30T07:40:00.000Z", activeLeases: 0 }
      ],
      probes: { database: "ok", objectStore: "ok", composio: "degraded", mcp: "ok" }
    });

    expect(result.snapshot.status).toBe("degraded");
    expect(result.snapshot.alerts.map((alert) => alert.kind)).toEqual(expect.arrayContaining(["queue-depth", "worker-stale"]));
    expect(result.snapshot.components.find((component) => component.name === "queue")?.status).toBe("degraded");
    expect(result.snapshot.workers.find((worker) => worker.id === "worker_stale")?.status).toBe("stale");
  });

  it("creates and restores backups with checksum and event-ledger verification", async () => {
    const service = createOperabilityService({ store: memoryStore(), repository: repository(), now: () => "2026-06-30T08:00:00.000Z" });

    const backup = await service.createBackup({ principal: admin, label: "pre-upgrade" });
    const restore = await service.restoreBackup({ principal: admin, backupId: backup.record.id });

    expect(backup.record.checksum).toMatch(/^sha256:/);
    expect(backup.record.eventLedgerCount).toBe(2);
    expect(restore.record.status).toBe("completed");
    expect(restore.record.eventLedgerVerified).toBe(true);
  });

  it("rejects restore when checksum does not match", async () => {
    const service = createOperabilityService({ store: memoryStore(), repository: repository(), now: () => "2026-06-30T08:00:00.000Z" });
    const backup = await service.createBackup({ principal: admin, label: "pre-upgrade" });

    const restore = await service.restoreBackup({ principal: admin, payload: backup.record.payload, checksum: "sha256:bad" });

    expect(restore.record.status).toBe("failed");
    expect(restore.record.deniedReasons.join(" ")).toMatch(/checksum/i);
  });

  it("records failed migration rollback with connector checkpoint replay guidance", async () => {
    const service = createOperabilityService({ store: memoryStore(), repository: repository(), now: () => "2026-06-30T08:00:00.000Z" });
    const backup = await service.createBackup({ principal: admin, label: "pre-migration" });

    const recovery = await service.recordMigrationFailure({
      principal: admin,
      migrationId: "20260630_add_ops_tables",
      failedStep: "create index concurrently",
      error: "lock timeout",
      backupId: backup.record.id,
      connectorCheckpointIds: ["slack:acct_slack", "github:acct_github"]
    });

    expect(recovery.record.status).toBe("rollback-ready");
    expect(recovery.record.rollbackCommands).toEqual(expect.arrayContaining(["npm run db:migrate:dry-run"]));
    expect(recovery.record.restoreBackupId).toBe(backup.record.id);
    expect(recovery.record.connectorReplayPlan).toEqual(expect.arrayContaining(["POST /api/v1/connectors/replay for checkpoint slack:acct_slack"]));
  });

  it("validates the Helm chart deployment surface", async () => {
    const service = createOperabilityService({ store: memoryStore(), repository: repository(), now: () => "2026-06-30T08:00:00.000Z" });

    const validation = await service.validateHelmChart({ chartRoot: join(process.cwd(), "deploy", "helm", "company-brain") });

    expect(validation.valid).toBe(true);
    expect(validation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "app-deployment", passed: true }),
        expect.objectContaining({ id: "worker-deployment", passed: true }),
        expect.objectContaining({ id: "scheduler-deployment", passed: true }),
        expect.objectContaining({ id: "postgres-internal-external", passed: true }),
        expect.objectContaining({ id: "redis-internal-external", passed: true }),
        expect.objectContaining({ id: "object-storage", passed: true }),
        expect.objectContaining({ id: "secrets", passed: true })
      ])
    );
  });

  it("serves health, backup, restore, migration recovery, and status through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-operability-"));
    process.env.OPERABILITY_STATE_PATH = join(dir, "ops.json");
    vi.resetModules();

    const healthRoute = await import("../app/api/v1/ops/health/route");
    const backupRoute = await import("../app/api/v1/ops/backup/route");
    const restoreRoute = await import("../app/api/v1/ops/restore/route");
    const migrationRoute = await import("../app/api/v1/ops/migrations/recover/route");
    const statusRoute = await import("../app/api/v1/ops/status/route");

    const health = await healthRoute.POST(
      jsonRequest("/api/v1/ops/health", {
        principal: admin,
        queueDepth: 600,
        queueDepthThreshold: 500,
        workers: [{ id: "worker_api", role: "scheduler", lastHeartbeatAt: new Date().toISOString() }],
        probes: { database: "ok", objectStore: "ok", composio: "ok", mcp: "ok" }
      })
    );
    expect(health.status).toBe(200);

    const backupResponse = await backupRoute.POST(jsonRequest("/api/v1/ops/backup", { principal: admin, label: "api-backup" }));
    const backupBody = await backupResponse.json();
    expect(backupBody.record.status).toBe("completed");

    const restoreResponse = await restoreRoute.POST(jsonRequest("/api/v1/ops/restore", { principal: admin, backupId: backupBody.record.id }));
    expect(restoreResponse.status).toBe(200);

    const migration = await migrationRoute.POST(
      jsonRequest("/api/v1/ops/migrations/recover", {
        principal: admin,
        migrationId: "20260630_api",
        failedStep: "alter table",
        error: "statement timeout",
        backupId: backupBody.record.id,
        connectorCheckpointIds: ["slack:acct_slack"]
      })
    );
    expect(migration.status).toBe(200);

    const state = await statusRoute.GET();
    const body = await state.json();
    expect(body.healthSnapshots).toHaveLength(1);
    expect(body.backups).toHaveLength(1);
    expect(body.restores).toHaveLength(1);
    expect(body.migrationRecoveries).toHaveLength(1);
  });
});
