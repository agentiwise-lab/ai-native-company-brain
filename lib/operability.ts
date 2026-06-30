import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repository as defaultRepository } from "./repository";
import type { BrainEvent, DashboardSnapshot, Principal } from "./types";
import type { BrainRepository } from "./repository-contract";

export type OperabilityComponent = "app" | "worker" | "scheduler" | "database" | "object-store" | "queue" | "composio" | "mcp";
export type TelemetryType = "log" | "metric" | "trace";
export type HealthStatus = "ok" | "degraded" | "down";

export type TelemetryEvent = {
  id: string;
  component: OperabilityComponent;
  type: TelemetryType;
  severity?: "debug" | "info" | "warn" | "error";
  name?: string;
  value?: number;
  traceId?: string;
  durationMs?: number;
  message?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkerHealth = {
  id: string;
  role: "app" | "worker" | "scheduler" | "connector";
  lastHeartbeatAt: string;
  activeLeases: number;
  status: "active" | "stale";
};

export type HealthComponent = {
  name: OperabilityComponent;
  status: HealthStatus;
  detail: string;
  metrics?: Record<string, number>;
};

export type OpsAlert = {
  id: string;
  kind: "queue-depth" | "worker-stale" | "component-down" | "component-degraded";
  severity: "warning" | "critical";
  message: string;
  createdAt: string;
};

export type HealthSnapshot = {
  id: string;
  status: HealthStatus;
  generatedAt: string;
  queueDepth: number;
  queueDepthThreshold: number;
  workers: WorkerHealth[];
  components: HealthComponent[];
  alerts: OpsAlert[];
};

export type BackupPayload = {
  version: 1;
  label: string;
  createdAt: string;
  tenantId: string;
  dashboard: DashboardSnapshot;
  events: BrainEvent[];
  eventLedgerCount: number;
};

export type BackupRecord = {
  id: string;
  label: string;
  requestedBy: string;
  status: "completed" | "denied";
  checksum: string;
  byteSize: number;
  eventLedgerCount: number;
  payload: BackupPayload;
  deniedReasons: string[];
  createdAt: string;
};

export type RestoreRecord = {
  id: string;
  requestedBy: string;
  backupId?: string;
  status: "completed" | "failed" | "denied";
  checksumVerified: boolean;
  eventLedgerVerified: boolean;
  restoredAtomCount: number;
  restoredEventCount: number;
  deniedReasons: string[];
  createdAt: string;
};

export type MigrationRecoveryRecord = {
  id: string;
  requestedBy: string;
  migrationId: string;
  failedStep: string;
  error: string;
  status: "rollback-ready" | "denied";
  restoreBackupId?: string;
  rollbackCommands: string[];
  connectorReplayPlan: string[];
  createdAt: string;
};

export type HelmValidationCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export type HelmValidation = {
  valid: boolean;
  chartRoot: string;
  checks: HelmValidationCheck[];
};

export type OperabilityState = {
  telemetryEvents: TelemetryEvent[];
  healthSnapshots: HealthSnapshot[];
  backups: BackupRecord[];
  restores: RestoreRecord[];
  migrationRecoveries: MigrationRecoveryRecord[];
  auditEvents: BrainEvent[];
};

export type OperabilityStore = {
  read(): Promise<OperabilityState | null>;
  write(state: OperabilityState): Promise<void>;
};

type RecordTelemetryInput = Omit<TelemetryEvent, "id" | "createdAt" | "metadata"> & {
  metadata?: Record<string, unknown>;
};

type CollectHealthInput = {
  principal: Principal;
  queueDepth: number;
  queueDepthThreshold?: number;
  workers: Array<Omit<WorkerHealth, "status">>;
  probes?: Partial<Record<"database" | "objectStore" | "composio" | "mcp", HealthStatus | "ok">>;
};

type CreateBackupInput = {
  principal: Principal;
  label: string;
};

type RestoreBackupInput = {
  principal: Principal;
  backupId?: string;
  payload?: BackupPayload;
  checksum?: string;
};

type RecordMigrationFailureInput = {
  principal: Principal;
  migrationId: string;
  failedStep: string;
  error: string;
  backupId?: string;
  connectorCheckpointIds?: string[];
};

type ValidateHelmInput = {
  chartRoot?: string;
};

type Options = {
  store?: OperabilityStore;
  repository?: BrainRepository;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

function defaultStatePath() {
  return process.env.OPERABILITY_STATE_PATH ?? join(process.cwd(), "data", "operability-state.json");
}

function createFileStore(path = defaultStatePath()): OperabilityStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as OperabilityState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): OperabilityState {
  return {
    telemetryEvents: [],
    healthSnapshots: [],
    backups: [],
    restores: [],
    migrationRecoveries: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasAuditAuthority(principal: Principal) {
  return principal.role === "admin" || principal.scopes.includes("audit:read");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function byteSize(value: unknown) {
  return Buffer.byteLength(stableStringify(value), "utf8");
}

function secondsBetween(left: string, right: string) {
  return Math.max(0, Math.round((Date.parse(right) - Date.parse(left)) / 1000));
}

function aggregateStatus(components: HealthComponent[], alerts: OpsAlert[]): HealthStatus {
  if (components.some((component) => component.status === "down") || alerts.some((alert) => alert.severity === "critical")) {
    return "down";
  }
  if (components.some((component) => component.status === "degraded") || alerts.length > 0) {
    return "degraded";
  }
  return "ok";
}

async function readChartFiles(root: string) {
  async function walk(path: string): Promise<string[]> {
    const entries = await readdir(path, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const next = join(path, entry.name);
        return entry.isDirectory() ? walk(next) : Promise.resolve([next]);
      })
    );
    return nested.flat();
  }
  const files = await walk(root);
  const contents = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")] as const));
  return Object.fromEntries(contents);
}

export function createOperabilityService(options: Options = {}) {
  const store = options.store ?? createFileStore();
  const repository = options.repository ?? defaultRepository;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: OperabilityState) {
    await store.write(state);
  }

  function audit(input: {
    actorId: string;
    action: BrainEvent["action"];
    targetId: string;
    targetType: BrainEvent["targetType"];
    policyDecision: BrainEvent["policyDecision"];
    metadata: Record<string, unknown>;
    createdAt: string;
  }): BrainEvent {
    return {
      id: id("evt_ops"),
      tenantId,
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      targetType: input.targetType,
      policyDecision: input.policyDecision,
      metadata: input.metadata,
      createdAt: input.createdAt
    };
  }

  return {
    async getState() {
      return load();
    },

    async recordTelemetry(input: RecordTelemetryInput) {
      const state = await load();
      const event: TelemetryEvent = {
        id: id("telemetry"),
        component: input.component,
        type: input.type,
        severity: input.severity,
        name: input.name,
        value: input.value,
        traceId: input.traceId,
        durationMs: input.durationMs,
        message: input.message,
        metadata: input.metadata ?? {},
        createdAt: now()
      };
      state.telemetryEvents = [event, ...state.telemetryEvents];
      await save(state);
      return event;
    },

    async collectHealth(input: CollectHealthInput) {
      const state = await load();
      const timestamp = now();
      const threshold = input.queueDepthThreshold ?? 1000;
      const workers: WorkerHealth[] = input.workers.map((worker) => ({
        ...worker,
        status: secondsBetween(worker.lastHeartbeatAt, timestamp) > 300 ? "stale" : "active"
      }));
      const alerts: OpsAlert[] = [];
      if (input.queueDepth > threshold) {
        alerts.push({
          id: id("ops_alert"),
          kind: "queue-depth",
          severity: "warning",
          message: `Queue depth ${input.queueDepth} exceeds threshold ${threshold}.`,
          createdAt: timestamp
        });
      }
      for (const worker of workers.filter((candidate) => candidate.status === "stale")) {
        alerts.push({
          id: id("ops_alert"),
          kind: "worker-stale",
          severity: "warning",
          message: `Worker ${worker.id} has not heartbeated since ${worker.lastHeartbeatAt}.`,
          createdAt: timestamp
        });
      }

      const probe = input.probes ?? {};
      const components: HealthComponent[] = [
        { name: "app", status: "ok", detail: "Next.js app process is reporting health." },
        { name: "database", status: probe.database ?? "ok", detail: "Postgres repository and migrations are reachable." },
        { name: "object-store", status: probe.objectStore ?? "ok", detail: "Object storage probe completed." },
        { name: "queue", status: input.queueDepth > threshold ? "degraded" : "ok", detail: `Queue depth ${input.queueDepth}.`, metrics: { depth: input.queueDepth, threshold } },
        { name: "scheduler", status: workers.some((worker) => worker.role === "scheduler" && worker.status === "stale") ? "degraded" : "ok", detail: "Durable scheduler leases and workers checked." },
        { name: "worker", status: workers.some((worker) => worker.status === "stale") ? "degraded" : "ok", detail: `${workers.length} worker heartbeat(s) checked.` },
        { name: "composio", status: probe.composio ?? "ok", detail: "Composio control-plane/tool probe completed." },
        { name: "mcp", status: probe.mcp ?? "ok", detail: "MCP surface probe completed." }
      ];
      for (const component of components.filter((item) => item.status === "down" || item.status === "degraded")) {
        if (component.name === "queue" || component.name === "worker" || component.name === "scheduler") {
          continue;
        }
        alerts.push({
          id: id("ops_alert"),
          kind: component.status === "down" ? "component-down" : "component-degraded",
          severity: component.status === "down" ? "critical" : "warning",
          message: `${component.name} is ${component.status}: ${component.detail}`,
          createdAt: timestamp
        });
      }
      const snapshot: HealthSnapshot = {
        id: id("health"),
        status: aggregateStatus(components, alerts),
        generatedAt: timestamp,
        queueDepth: input.queueDepth,
        queueDepthThreshold: threshold,
        workers,
        components,
        alerts
      };
      const event = audit({
        actorId: input.principal.id,
        action: "ops.health",
        targetId: snapshot.id,
        targetType: "ops",
        policyDecision: hasAuditAuthority(input.principal) ? "allow" : "deny",
        metadata: { status: snapshot.status, alertKinds: alerts.map((alert) => alert.kind), queueDepth: input.queueDepth },
        createdAt: timestamp
      });
      state.healthSnapshots = [snapshot, ...state.healthSnapshots];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { snapshot, auditEvent: event };
    },

    async createBackup(input: CreateBackupInput) {
      const state = await load();
      const timestamp = now();
      const deniedReasons = hasAuditAuthority(input.principal) ? [] : ["Backup requires audit:read scope or admin role."];
      const dashboard = await repository.dashboard();
      const events = await repository.allEvents();
      const payload: BackupPayload = {
        version: 1,
        label: input.label,
        createdAt: timestamp,
        tenantId,
        dashboard,
        events,
        eventLedgerCount: events.length
      };
      const record: BackupRecord = {
        id: id("backup"),
        label: input.label,
        requestedBy: input.principal.id,
        status: deniedReasons.length > 0 ? "denied" : "completed",
        checksum: checksum(payload),
        byteSize: byteSize(payload),
        eventLedgerCount: events.length,
        payload,
        deniedReasons,
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "backup.create",
        targetId: record.id,
        targetType: "backup",
        policyDecision: record.status === "denied" ? "deny" : "allow",
        metadata: { label: input.label, checksum: record.checksum, eventLedgerCount: record.eventLedgerCount, deniedReasons },
        createdAt: timestamp
      });
      state.backups = [record, ...state.backups];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { record, auditEvent: event };
    },

    async restoreBackup(input: RestoreBackupInput) {
      const state = await load();
      const timestamp = now();
      const backup = input.backupId ? state.backups.find((candidate) => candidate.id === input.backupId) : undefined;
      const payload = input.payload ?? backup?.payload;
      const expectedChecksum = input.checksum ?? backup?.checksum;
      const deniedReasons: string[] = [];
      if (!hasAuditAuthority(input.principal)) {
        deniedReasons.push("Restore requires audit:read scope or admin role.");
      }
      if (!payload) {
        deniedReasons.push("Backup payload was not found.");
      }
      const actualChecksum = payload ? checksum(payload) : "";
      if (payload && expectedChecksum && actualChecksum !== expectedChecksum) {
        deniedReasons.push(`Backup checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}.`);
      }
      const eventLedgerVerified = Boolean(payload && payload.events.length === payload.eventLedgerCount);
      if (payload && !eventLedgerVerified) {
        deniedReasons.push("Event ledger count did not match backup payload.");
      }
      const record: RestoreRecord = {
        id: id("restore"),
        requestedBy: input.principal.id,
        backupId: input.backupId,
        status: deniedReasons.length > 0 ? (hasAuditAuthority(input.principal) ? "failed" : "denied") : "completed",
        checksumVerified: Boolean(payload && expectedChecksum && actualChecksum === expectedChecksum),
        eventLedgerVerified,
        restoredAtomCount: payload?.dashboard.atoms.length ?? 0,
        restoredEventCount: payload?.events.length ?? 0,
        deniedReasons,
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "backup.restore",
        targetId: record.id,
        targetType: "restore",
        policyDecision: record.status === "completed" ? "allow" : "deny",
        metadata: {
          backupId: input.backupId,
          checksumVerified: record.checksumVerified,
          eventLedgerVerified: record.eventLedgerVerified,
          deniedReasons
        },
        createdAt: timestamp
      });
      state.restores = [record, ...state.restores];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { record, auditEvent: event };
    },

    async recordMigrationFailure(input: RecordMigrationFailureInput) {
      const state = await load();
      const timestamp = now();
      const allowed = input.principal.role === "admin";
      const rollbackCommands = [
        "npm run db:migrate:dry-run",
        input.backupId ? `POST /api/v1/ops/restore with backupId ${input.backupId}` : "Create or locate a verified backup before retrying migration.",
        "Retry migration only after restore verification and connector replay checks pass."
      ];
      const connectorReplayPlan = (input.connectorCheckpointIds ?? []).map((checkpointId) => `POST /api/v1/connectors/replay for checkpoint ${checkpointId}`);
      const record: MigrationRecoveryRecord = {
        id: id("migration_recovery"),
        requestedBy: input.principal.id,
        migrationId: input.migrationId,
        failedStep: input.failedStep,
        error: input.error,
        status: allowed ? "rollback-ready" : "denied",
        restoreBackupId: input.backupId,
        rollbackCommands,
        connectorReplayPlan,
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "migration.recover",
        targetId: record.id,
        targetType: "migration",
        policyDecision: allowed ? "allow" : "deny",
        metadata: { migrationId: input.migrationId, failedStep: input.failedStep, backupId: input.backupId, connectorCheckpointIds: input.connectorCheckpointIds ?? [] },
        createdAt: timestamp
      });
      state.migrationRecoveries = [record, ...state.migrationRecoveries];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { record, auditEvent: event };
    },

    async validateHelmChart(input: ValidateHelmInput = {}): Promise<HelmValidation> {
      const chartRoot = input.chartRoot ?? join(process.cwd(), "deploy", "helm", "company-brain");
      const files = await readChartFiles(chartRoot);
      const combined = Object.values(files).join("\n");
      const checks: HelmValidationCheck[] = [
        { id: "app-deployment", passed: /name:\s*app|component:\s*app|company-brain-app/.test(combined), detail: "App deployment template exists." },
        { id: "worker-deployment", passed: /worker|workers/.test(combined), detail: "Worker deployment template exists." },
        { id: "scheduler-deployment", passed: /scheduler/.test(combined), detail: "Scheduler deployment template exists." },
        { id: "postgres-internal-external", passed: /postgresql:\s*\n[\s\S]*enabled:|externalPostgres|DATABASE_URL/.test(combined), detail: "Postgres can run in-chart or use external connection." },
        { id: "redis-internal-external", passed: /redis:\s*\n[\s\S]*enabled:|externalRedis|REDIS_URL/.test(combined), detail: "Redis can run in-chart or use external connection." },
        { id: "object-storage", passed: /objectStorage|S3_|MINIO_|OBJECT_STORE/.test(combined), detail: "Object storage configuration exists." },
        { id: "secrets", passed: /kind:\s*Secret|existingSecret|secretKeyRef/.test(combined), detail: "Secret handling is represented." }
      ];
      return { chartRoot, checks, valid: checks.every((check) => check.passed) };
    }
  };
}

export const operabilityService = createOperabilityService();
