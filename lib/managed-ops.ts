import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrainEvent, Principal } from "./types";
import type { CloudPlan } from "./cloud-control-plane";

export type UsageMeasurements = {
  connectorSyncs?: number;
  composioActions?: number;
  toolInvocations?: number;
  storageBytes?: number;
  queryCount?: number;
  cronRuns?: number;
  workerMs?: number;
};

export type RequiredUsageMeasurements = Required<UsageMeasurements>;

export type PlanLimits = RequiredUsageMeasurements & {
  budgetUsd: number;
};

export type UsageEvent = {
  id: string;
  tenantId: string;
  plan: CloudPlan;
  measurements: RequiredUsageMeasurements;
  costUsd: number;
  recordedBy: string;
  createdAt: string;
};

export type UsageSummary = {
  id: string;
  tenantId: string;
  plan: CloudPlan;
  usage: RequiredUsageMeasurements;
  costUsd: number;
  limits: PlanLimits;
  percentOfBudget: number;
  updatedAt: string;
};

export type ManagedOpsAlert = {
  id: string;
  tenantId: string;
  kind: "plan-limit" | "budget" | "worker-failure";
  severity: "warning" | "critical";
  message: string;
  createdAt: string;
};

export type SupportView = {
  id: string;
  tenantId: string;
  status: "available" | "denied";
  usage?: UsageSummary;
  alerts: ManagedOpsAlert[];
  workerRecoveries: Array<Pick<WorkerRecoveryRecord, "id" | "tenantId" | "workerId" | "role" | "status" | "recoverySteps" | "replayPlan" | "createdAt"> & { error: string }>;
  queueDepth: number;
  deniedReasons: string[];
  createdAt: string;
};

export type WorkerRecoveryRecord = {
  id: string;
  tenantId: string;
  workerId: string;
  role: "scheduler" | "connector" | "worker";
  error: string;
  status: "recovery-ready" | "denied";
  checkpointIds: string[];
  leaseIds: string[];
  recoverySteps: string[];
  replayPlan: string[];
  createdAt: string;
};

export type UpgradePlanRecord = {
  id: string;
  tenantId: string;
  fromVersion: string;
  toVersion: string;
  status: "planned" | "denied";
  preserved: {
    connectorCheckpoints: string[];
    cronSchedules: string[];
    packageVersions: string[];
  };
  replaySteps: string[];
  createdAt: string;
};

export type ManagedOpsState = {
  usageEvents: UsageEvent[];
  usageSummaries: UsageSummary[];
  alerts: ManagedOpsAlert[];
  supportViews: SupportView[];
  workerRecoveries: WorkerRecoveryRecord[];
  upgradePlans: UpgradePlanRecord[];
  auditEvents: BrainEvent[];
};

export type ManagedOpsStore = {
  read(): Promise<ManagedOpsState | null>;
  write(state: ManagedOpsState): Promise<void>;
};

type RecordUsageInput = {
  principal: Principal;
  tenantId: string;
  plan?: CloudPlan;
  measurements: UsageMeasurements;
};

type EnforceLimitInput = {
  principal: Principal;
  tenantId: string;
  plan?: CloudPlan;
  requested: UsageMeasurements;
};

type SupportViewInput = {
  principal: Principal;
  tenantId: string;
};

type WorkerFailureInput = {
  principal: Principal;
  tenantId: string;
  workerId: string;
  role: WorkerRecoveryRecord["role"];
  error: string;
  checkpointIds?: string[];
  leaseIds?: string[];
};

type UpgradePlanInput = {
  principal: Principal;
  tenantId: string;
  fromVersion: string;
  toVersion: string;
  connectorCheckpoints: string[];
  cronSchedules: string[];
  packageVersions: string[];
};

type Options = {
  store?: ManagedOpsStore;
  planLimits?: Partial<Record<CloudPlan, PlanLimits>>;
  now?: () => string;
  id?: (prefix: string) => string;
  platformTenantId?: string;
};

const defaultPlanLimits: Record<CloudPlan, PlanLimits> = {
  team: {
    connectorSyncs: 10_000,
    composioActions: 20_000,
    toolInvocations: 20_000,
    storageBytes: 25_000_000_000,
    queryCount: 50_000,
    cronRuns: 5_000,
    workerMs: 36_000_000,
    budgetUsd: 500
  },
  business: {
    connectorSyncs: 100_000,
    composioActions: 250_000,
    toolInvocations: 250_000,
    storageBytes: 250_000_000_000,
    queryCount: 500_000,
    cronRuns: 50_000,
    workerMs: 360_000_000,
    budgetUsd: 5000
  },
  enterprise: {
    connectorSyncs: 1_000_000,
    composioActions: 2_500_000,
    toolInvocations: 2_500_000,
    storageBytes: 2_500_000_000_000,
    queryCount: 5_000_000,
    cronRuns: 500_000,
    workerMs: 3_600_000_000,
    budgetUsd: 50_000
  }
};

const emptyUsage: RequiredUsageMeasurements = {
  connectorSyncs: 0,
  composioActions: 0,
  toolInvocations: 0,
  storageBytes: 0,
  queryCount: 0,
  cronRuns: 0,
  workerMs: 0
};

function defaultStatePath() {
  return process.env.MANAGED_OPS_STATE_PATH ?? join(process.cwd(), "data", "managed-ops-state.json");
}

function createFileStore(path = defaultStatePath()): ManagedOpsStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ManagedOpsState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): ManagedOpsState {
  return {
    usageEvents: [],
    usageSummaries: [],
    alerts: [],
    supportViews: [],
    workerRecoveries: [],
    upgradePlans: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUsage(input: UsageMeasurements): RequiredUsageMeasurements {
  return { ...emptyUsage, ...input };
}

function addUsage(left: RequiredUsageMeasurements, right: RequiredUsageMeasurements): RequiredUsageMeasurements {
  return {
    connectorSyncs: left.connectorSyncs + right.connectorSyncs,
    composioActions: left.composioActions + right.composioActions,
    toolInvocations: left.toolInvocations + right.toolInvocations,
    storageBytes: left.storageBytes + right.storageBytes,
    queryCount: left.queryCount + right.queryCount,
    cronRuns: left.cronRuns + right.cronRuns,
    workerMs: left.workerMs + right.workerMs
  };
}

function usageCost(usage: RequiredUsageMeasurements) {
  return Number(
    (
      usage.connectorSyncs * 0.002 +
      usage.composioActions * 0.001 +
      usage.toolInvocations * 0.0008 +
      usage.storageBytes / 1_000_000_000 * 0.08 +
      usage.queryCount * 0.0002 +
      usage.cronRuns * 0.003 +
      usage.workerMs / 3_600_000 * 0.05
    ).toFixed(4)
  );
}

function tenantAdmin(principal: Principal, tenantId: string) {
  return principal.scopes.includes(`tenant:${tenantId}:admin`) || principal.scopes.includes("cloud:provision") || (principal.role === "admin" && principal.scopes.includes("audit:read"));
}

function supportAllowed(principal: Principal, tenantId: string) {
  return principal.scopes.includes("support:read") || tenantAdmin(principal, tenantId);
}

function sanitize(value: string) {
  return value
    .replace(/secret:\/\/\S+/g, "[redacted-secret]")
    .replace(/restricted[^,.]*/gi, "[redacted-content]")
    .replace(/customer ssn/gi, "[redacted-content]");
}

function exceededKeys(usage: RequiredUsageMeasurements, limits: PlanLimits) {
  return (Object.keys(emptyUsage) as Array<keyof RequiredUsageMeasurements>).filter((key) => usage[key] > limits[key]);
}

export function createManagedOpsService(options: Options = {}) {
  const store = options.store ?? createFileStore();
  const limits = { ...defaultPlanLimits, ...options.planLimits };
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const platformTenantId = options.platformTenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ManagedOpsState) {
    await store.write(state);
  }

  function audit(input: {
    actorId: string;
    action: BrainEvent["action"];
    targetId: string;
    policyDecision: BrainEvent["policyDecision"];
    metadata: Record<string, unknown>;
    createdAt: string;
  }): BrainEvent {
    return {
      id: id("evt_managed_ops"),
      tenantId: platformTenantId,
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      targetType: "ops",
      policyDecision: input.policyDecision,
      metadata: input.metadata,
      createdAt: input.createdAt
    };
  }

  function summaryFor(state: ManagedOpsState, tenantId: string, plan: CloudPlan, timestamp: string) {
    const usage = state.usageEvents
      .filter((event) => event.tenantId === tenantId)
      .reduce((sum, event) => addUsage(sum, event.measurements), { ...emptyUsage });
    const costUsd = usageCost(usage);
    const planLimits = limits[plan];
    return {
      id: id("usage_summary"),
      tenantId,
      plan,
      usage,
      costUsd,
      limits: planLimits,
      percentOfBudget: planLimits.budgetUsd > 0 ? Math.round((costUsd / planLimits.budgetUsd) * 100) : 0,
      updatedAt: timestamp
    };
  }

  return {
    async getState() {
      return load();
    },

    async recordUsage(input: RecordUsageInput) {
      const state = await load();
      const timestamp = now();
      if (!tenantAdmin(input.principal, input.tenantId)) {
        throw new Error(`Principal ${input.principal.id} cannot record usage for ${input.tenantId}.`);
      }
      const measurements = normalizeUsage(input.measurements);
      const event: UsageEvent = {
        id: id("usage_event"),
        tenantId: input.tenantId,
        plan: input.plan ?? "team",
        measurements,
        costUsd: usageCost(measurements),
        recordedBy: input.principal.id,
        createdAt: timestamp
      };
      state.usageEvents = [event, ...state.usageEvents];
      const summary = summaryFor(state, input.tenantId, event.plan, timestamp);
      state.usageSummaries = [summary, ...state.usageSummaries.filter((candidate) => candidate.tenantId !== input.tenantId)];
      const auditEvent = audit({
        actorId: input.principal.id,
        action: "managed-ops.usage.record",
        targetId: input.tenantId,
        policyDecision: "allow",
        metadata: { measurements, costUsd: event.costUsd },
        createdAt: timestamp
      });
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return { event, summary, auditEvent };
    },

    async enforcePlanLimit(input: EnforceLimitInput) {
      const state = await load();
      const timestamp = now();
      const plan = input.plan ?? state.usageSummaries.find((summary) => summary.tenantId === input.tenantId)?.plan ?? "team";
      const current = state.usageSummaries.find((summary) => summary.tenantId === input.tenantId)?.usage ?? { ...emptyUsage };
      const requested = normalizeUsage(input.requested);
      const projected = addUsage(current, requested);
      const planLimits = limits[plan];
      const over = exceededKeys(projected, planLimits);
      const costUsd = usageCost(projected);
      if (costUsd > planLimits.budgetUsd) {
        over.push("workerMs");
      }
      const alerts = over.length > 0
        ? [
            {
              id: id("managed_alert"),
              tenantId: input.tenantId,
              kind: "plan-limit" as const,
              severity: "critical" as const,
              message: `Plan limit would be exceeded for ${over.join(", ")}.`,
              createdAt: timestamp
            }
          ]
        : [];
      const auditEvent = audit({
        actorId: input.principal.id,
        action: "managed-ops.plan.block",
        targetId: input.tenantId,
        policyDecision: over.length > 0 ? "deny" : "allow",
        metadata: { projected, plan, over },
        createdAt: timestamp
      });
      state.alerts = [...alerts, ...state.alerts];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return {
        allowed: over.length === 0,
        reasons: over.length === 0 ? ["Projected usage is within plan limits."] : [`Plan limit would be exceeded for ${over.join(", ")}.`],
        projected,
        alerts,
        auditEvent
      };
    },

    async supportView(input: SupportViewInput) {
      const state = await load();
      const timestamp = now();
      const allowed = supportAllowed(input.principal, input.tenantId);
      const deniedReasons = allowed ? [] : [`Principal ${input.principal.id} cannot inspect tenant ${input.tenantId}.`];
      const recoveries = state.workerRecoveries
        .filter((record) => record.tenantId === input.tenantId)
        .map((record) => ({
          id: record.id,
          tenantId: record.tenantId,
          workerId: record.workerId,
          role: record.role,
          status: record.status,
          recoverySteps: record.recoverySteps.map(sanitize),
          replayPlan: record.replayPlan.map(sanitize),
          error: sanitize(record.error),
          createdAt: record.createdAt
        }));
      const view: SupportView = {
        id: id("support_view"),
        tenantId: input.tenantId,
        status: allowed ? "available" : "denied",
        usage: allowed ? state.usageSummaries.find((summary) => summary.tenantId === input.tenantId) : undefined,
        alerts: allowed ? state.alerts.filter((alert) => alert.tenantId === input.tenantId) : [],
        workerRecoveries: allowed ? recoveries : [],
        queueDepth: allowed ? state.alerts.filter((alert) => alert.tenantId === input.tenantId && alert.kind === "plan-limit").length : 0,
        deniedReasons,
        createdAt: timestamp
      };
      const auditEvent = audit({
        actorId: input.principal.id,
        action: "managed-ops.support.view",
        targetId: input.tenantId,
        policyDecision: allowed ? "allow" : "deny",
        metadata: { deniedReasons },
        createdAt: timestamp
      });
      state.supportViews = [view, ...state.supportViews];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return { view, auditEvent };
    },

    async recordWorkerFailure(input: WorkerFailureInput) {
      const state = await load();
      const timestamp = now();
      if (!tenantAdmin(input.principal, input.tenantId)) {
        throw new Error(`Principal ${input.principal.id} cannot recover workers for ${input.tenantId}.`);
      }
      const leaseIds = input.leaseIds ?? [];
      const checkpointIds = input.checkpointIds ?? [];
      const record: WorkerRecoveryRecord = {
        id: id("worker_recovery"),
        tenantId: input.tenantId,
        workerId: input.workerId,
        role: input.role,
        error: input.error,
        status: "recovery-ready",
        checkpointIds,
        leaseIds,
        recoverySteps: [
          ...leaseIds.map((leaseId) => `release scheduler lease ${leaseId}`),
          `restart ${input.role} worker ${input.workerId}`,
          "verify queue depth and retry policy before resuming"
        ],
        replayPlan: checkpointIds.map((checkpointId) => `POST /api/v1/connectors/replay for checkpoint ${checkpointId}`),
        createdAt: timestamp
      };
      const alert: ManagedOpsAlert = {
        id: id("managed_alert"),
        tenantId: input.tenantId,
        kind: "worker-failure",
        severity: "warning",
        message: `${input.role} worker ${input.workerId} failed.`,
        createdAt: timestamp
      };
      const auditEvent = audit({
        actorId: input.principal.id,
        action: "managed-ops.worker.recover",
        targetId: record.id,
        policyDecision: "allow",
        metadata: { tenantId: input.tenantId, workerId: input.workerId, checkpointIds, leaseIds },
        createdAt: timestamp
      });
      state.workerRecoveries = [record, ...state.workerRecoveries];
      state.alerts = [alert, ...state.alerts];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return { record, alert, auditEvent };
    },

    async planUpgrade(input: UpgradePlanInput) {
      const state = await load();
      const timestamp = now();
      if (!tenantAdmin(input.principal, input.tenantId)) {
        throw new Error(`Principal ${input.principal.id} cannot plan upgrades for ${input.tenantId}.`);
      }
      const record: UpgradePlanRecord = {
        id: id("upgrade_plan"),
        tenantId: input.tenantId,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        status: "planned",
        preserved: {
          connectorCheckpoints: [...input.connectorCheckpoints],
          cronSchedules: [...input.cronSchedules],
          packageVersions: [...input.packageVersions]
        },
        replaySteps: [
          ...input.connectorCheckpoints.map((checkpoint) => `replay connector checkpoint ${checkpoint}`),
          ...input.cronSchedules.map((schedule) => `verify cron schedule ${schedule}`),
          ...input.packageVersions.map((version) => `pin package version ${version}`)
        ],
        createdAt: timestamp
      };
      const auditEvent = audit({
        actorId: input.principal.id,
        action: "managed-ops.upgrade.plan",
        targetId: record.id,
        policyDecision: "allow",
        metadata: { tenantId: input.tenantId, fromVersion: input.fromVersion, toVersion: input.toVersion, preserved: record.preserved },
        createdAt: timestamp
      });
      state.upgradePlans = [record, ...state.upgradePlans];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return { record, auditEvent };
    }
  };
}

export const managedOpsService = createManagedOpsService();
