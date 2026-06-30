import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  composioControlPlane,
  type ComposioConnectedAccount,
  type ComposioState
} from "./composio-control-plane";
import {
  composioIngestionPipeline,
  type ComposioIngestionState,
  type NormalizedComposioArtifact
} from "./composio-ingestion";
import { connectorOps } from "./connector-ops";
import { atoms as seedAtoms } from "./seed";
import type { BrainEvent, KnowledgeAtom, Principal, Sensitivity } from "./types";

export type ConnectorFindingType =
  | "failed-sync"
  | "revoked-account"
  | "expired-auth"
  | "lag-spike"
  | "missing-scope"
  | "repeated-transform-failure";

export type ConnectorRepairTask = {
  id: string;
  key: string;
  connector: string;
  connectedAccountId: string;
  checkpointId?: string;
  sourceObjectId?: string;
  findingType: ConnectorFindingType;
  evidence: string[];
  recommendedAction: string;
  status: "open" | "resolved";
  createdBy: string;
  createdAt: string;
};

export type ConnectorTriageRun = {
  id: string;
  status: "succeeded";
  detectedCount: number;
  openedTaskCount: number;
  duplicatesSuppressed: number;
  createdAt: string;
};

export type OffboardingExportRecord = {
  id: string;
  subjectPrincipalId: string;
  requestedBy: string;
  status: "completed" | "denied";
  exportedAtomIds: string[];
  exportedArtifactIds: string[];
  revokedAccountIds: string[];
  remappedAccountIds: string[];
  deniedReasons: string[];
  createdAt: string;
};

export type ConnectorMaintenanceState = {
  triageRuns: ConnectorTriageRun[];
  repairTasks: ConnectorRepairTask[];
  offboardingExports: OffboardingExportRecord[];
  auditEvents: BrainEvent[];
};

export type ConnectorMaintenanceStore = {
  read(): Promise<ConnectorMaintenanceState | null>;
  write(state: ConnectorMaintenanceState): Promise<void>;
};

export type ConnectorHealthError = {
  id: string;
  status: string;
  connector: string;
  connectedAccountId: string;
  sourceObjectId?: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
  guidance?: string;
};

export type ConnectorHealthRecord = {
  connector: string;
  connectedAccountId: string;
  accountStatus: string;
  toolkitSlug?: string;
  lastCheckpoint?: {
    id: string;
    connector: string;
    connectedAccountId: string;
    cursor?: string;
    lastSourceObjectId?: string;
    updatedAt?: string;
  } | null;
  lagSeconds?: number | null;
  latestRun?: {
    id: string;
    connector: string;
    connectedAccountId: string;
    sourceObjectId?: string;
    status: string;
    message: string;
    startedAt: string;
    finishedAt?: string;
  };
  artifactCount?: number;
  recentErrors: ConnectorHealthError[];
  revokedAt?: string;
};

export type ConnectorHealthSnapshot = {
  generatedAt: string;
  connectors: ConnectorHealthRecord[];
};

export type ConnectorTriageInput = {
  principal: Principal;
  lagThresholdSeconds?: number;
  requiredScopes?: Record<string, string[]>;
  observedScopes?: Record<string, string[]>;
  authExpiresAt?: Record<string, string>;
  repeatedFailureThreshold?: number;
};

export type OffboardingInput = {
  principal: Principal;
  subjectPrincipalId: string;
  includeRestricted?: boolean;
  accountAction?: "revoke" | "remap";
  remapToPrincipalId?: string;
  reason?: string;
};

type ConnectorOpsLike = {
  health(): Promise<ConnectorHealthSnapshot>;
};

type ControlPlaneLike = {
  getState(): Promise<ComposioState>;
  revokeConnectedAccount?(accountId: string): Promise<ComposioConnectedAccount>;
};

type IngestionPipelineLike = {
  getState(): Promise<ComposioIngestionState>;
};

type AssistantOptions = {
  store?: ConnectorMaintenanceStore;
  connectorOps?: ConnectorOpsLike;
  controlPlane?: ControlPlaneLike;
  ingestionPipeline?: IngestionPipelineLike;
  knowledgeAtoms?: KnowledgeAtom[];
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

function defaultStatePath() {
  return process.env.CONNECTOR_MAINTENANCE_STATE_PATH ?? join(process.cwd(), "data", "connector-maintenance-state.json");
}

function createFileStore(path = defaultStatePath()): ConnectorMaintenanceStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ConnectorMaintenanceState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): ConnectorMaintenanceState {
  return {
    triageRuns: [],
    repairTasks: [],
    offboardingExports: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function secondsExpired(expiresAt: string | undefined, timestamp: string) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() <= new Date(timestamp).getTime();
}

function includesTransformFailure(error: ConnectorHealthError) {
  return /\b(transform|normaliz|mapping|schema|parse)\b/i.test(error.message);
}

function taskKey(input: Pick<ConnectorRepairTask, "findingType" | "connector" | "connectedAccountId" | "evidence">) {
  return `${input.findingType}:${input.connector}:${input.connectedAccountId}:${[...input.evidence].sort().join("|")}`;
}

function hasAuditAuthority(principal: Principal) {
  return principal.role === "admin" || principal.scopes.includes("audit:read");
}

function canExportSensitivity(principal: Principal, sensitivity: Sensitivity, includeRestricted = false) {
  if (!hasAuditAuthority(principal)) {
    return false;
  }
  if (sensitivity === "restricted") {
    return includeRestricted && principal.role === "admin";
  }
  return true;
}

function sensitivityForArtifact(artifact: NormalizedComposioArtifact) {
  return artifact.acl.sensitivity ?? artifact.source.sensitivity;
}

export function createConnectorMaintenanceAssistant(options: AssistantOptions = {}) {
  const store = options.store ?? createFileStore();
  const ops = options.connectorOps ?? (connectorOps as unknown as ConnectorOpsLike);
  const controlPlane = options.controlPlane ?? composioControlPlane;
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const knowledgeAtoms = options.knowledgeAtoms ?? seedAtoms;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ConnectorMaintenanceState) {
    await store.write(state);
  }

  function createRepairTask(input: {
    principal: Principal;
    connector: ConnectorHealthRecord;
    findingType: ConnectorFindingType;
    evidence: string[];
    recommendedAction: string;
    timestamp: string;
    sourceObjectId?: string;
  }): ConnectorRepairTask {
    const task: ConnectorRepairTask = {
      id: id("connector_repair"),
      key: "",
      connector: input.connector.connector,
      connectedAccountId: input.connector.connectedAccountId,
      checkpointId: input.connector.lastCheckpoint?.id,
      sourceObjectId: input.sourceObjectId ?? input.connector.latestRun?.sourceObjectId,
      findingType: input.findingType,
      evidence: input.evidence,
      recommendedAction: input.recommendedAction,
      status: "open",
      createdBy: input.principal.id,
      createdAt: input.timestamp
    };
    task.key = taskKey(task);
    return task;
  }

  function detectTriageTasks(input: ConnectorTriageInput, health: ConnectorHealthSnapshot, timestamp: string) {
    const tasks: ConnectorRepairTask[] = [];
    const lagThreshold = input.lagThresholdSeconds ?? 24 * 60 * 60;
    const repeatedFailureThreshold = input.repeatedFailureThreshold ?? 3;

    for (const connector of health.connectors) {
      if (connector.accountStatus === "revoked") {
        tasks.push(
          createRepairTask({
            principal: input.principal,
            connector,
            findingType: "revoked-account",
            evidence: [`accountStatus:${connector.accountStatus}`, connector.revokedAt ? `revokedAt:${connector.revokedAt}` : "revokedAt:unknown"],
            recommendedAction: "Stop future sync/tool execution and reassign connector ownership if the source is still required.",
            timestamp
          })
        );
      }

      if (secondsExpired(input.authExpiresAt?.[connector.connectedAccountId], timestamp)) {
        tasks.push(
          createRepairTask({
            principal: input.principal,
            connector,
            findingType: "expired-auth",
            evidence: [`authExpiredAt:${input.authExpiresAt?.[connector.connectedAccountId]}`],
            recommendedAction: "Reauthorize the connected account before the next sync or tool invocation.",
            timestamp
          })
        );
      }

      if (typeof connector.lagSeconds === "number" && connector.lagSeconds > lagThreshold) {
        tasks.push(
          createRepairTask({
            principal: input.principal,
            connector,
            findingType: "lag-spike",
            evidence: [`lagSeconds:${connector.lagSeconds}`, `thresholdSeconds:${lagThreshold}`],
            recommendedAction: "Replay from the last healthy checkpoint and inspect connector queue depth.",
            timestamp
          })
        );
      }

      const required = input.requiredScopes?.[connector.connectedAccountId] ?? [];
      const observed = new Set(input.observedScopes?.[connector.connectedAccountId] ?? []);
      const missing = required.filter((scope) => !observed.has(scope));
      if (missing.length > 0) {
        tasks.push(
          createRepairTask({
            principal: input.principal,
            connector,
            findingType: "missing-scope",
            evidence: missing.map((scope) => `missingScope:${scope}`),
            recommendedAction: "Request the missing connector scopes and retest the account before replaying.",
            timestamp
          })
        );
      }

      const transformFailures = connector.recentErrors.filter(includesTransformFailure);
      if (transformFailures.length >= repeatedFailureThreshold) {
        tasks.push(
          createRepairTask({
            principal: input.principal,
            connector,
            findingType: "repeated-transform-failure",
            evidence: [`transformFailures:${transformFailures.length}`, ...transformFailures.map((error) => `run:${error.id}`)],
            recommendedAction: "Inspect the transform mapping, sample payload shape, and sanitizer before replaying.",
            timestamp,
            sourceObjectId: transformFailures[0]?.sourceObjectId
          })
        );
      }

      const latestFailed = connector.latestRun?.status === "failed" ? connector.latestRun : undefined;
      const latestRecentError = connector.recentErrors[0];
      if ((latestFailed || latestRecentError) && transformFailures.length < repeatedFailureThreshold) {
        const failed = latestRecentError ?? latestFailed;
        tasks.push(
          createRepairTask({
            principal: input.principal,
            connector,
            findingType: "failed-sync",
            evidence: [`run:${failed?.id}`, `message:${failed?.message}`],
            recommendedAction: "Inspect the failed run evidence, connector permissions, source scope, and checkpoint cursor before retrying.",
            timestamp,
            sourceObjectId: failed?.sourceObjectId
          })
        );
      }
    }

    return tasks;
  }

  function auditEvent(input: {
    actorId: string;
    action: BrainEvent["action"];
    targetId: string;
    targetType: BrainEvent["targetType"];
    policyDecision: BrainEvent["policyDecision"];
    metadata: Record<string, unknown>;
    timestamp: string;
  }): BrainEvent {
    return {
      id: id("evt_connector_maintenance"),
      tenantId,
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      targetType: input.targetType,
      policyDecision: input.policyDecision,
      metadata: input.metadata,
      createdAt: input.timestamp
    };
  }

  return {
    async getState() {
      return load();
    },

    async triage(input: ConnectorTriageInput) {
      const state = await load();
      const timestamp = now();
      const health = await ops.health();
      const detectedTasks = detectTriageTasks(input, health, timestamp);
      const openKeys = new Set(state.repairTasks.filter((task) => task.status === "open").map((task) => task.key));
      const repairTasks = detectedTasks.filter((task) => !openKeys.has(task.key));
      const triageRun: ConnectorTriageRun = {
        id: id("connector_triage_run"),
        status: "succeeded",
        detectedCount: detectedTasks.length,
        openedTaskCount: repairTasks.length,
        duplicatesSuppressed: detectedTasks.length - repairTasks.length,
        createdAt: timestamp
      };
      const event = auditEvent({
        actorId: input.principal.id,
        action: "connector.triage",
        targetId: triageRun.id,
        targetType: "connector",
        policyDecision: "allow",
        metadata: {
          detectedCount: triageRun.detectedCount,
          openedTaskCount: triageRun.openedTaskCount,
          duplicatesSuppressed: triageRun.duplicatesSuppressed
        },
        timestamp
      });

      state.triageRuns = [triageRun, ...state.triageRuns];
      state.repairTasks = [...repairTasks, ...state.repairTasks];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);

      return { triageRun, repairTasks, duplicatesSuppressed: triageRun.duplicatesSuppressed, auditEvent: event };
    },

    async offboard(input: OffboardingInput) {
      const state = await load();
      const timestamp = now();
      const control = await controlPlane.getState();
      const ingestion = await ingestionPipeline.getState();
      const deniedReasons: string[] = [];

      if (!hasAuditAuthority(input.principal)) {
        deniedReasons.push("audit:read scope or admin role is required for offboarding export.");
      }

      const ownedAtoms = knowledgeAtoms.filter((atom) => atom.ownerId === input.subjectPrincipalId);
      const ownedArtifacts = ingestion.artifacts.filter((artifact) => artifact.principalId === input.subjectPrincipalId);
      const deniedAtoms = ownedAtoms.filter((atom) => !canExportSensitivity(input.principal, atom.acl.sensitivity, input.includeRestricted));
      const deniedArtifacts = ownedArtifacts.filter((artifact) => !canExportSensitivity(input.principal, sensitivityForArtifact(artifact), input.includeRestricted));

      if (deniedAtoms.length > 0 || deniedArtifacts.length > 0) {
        deniedReasons.push(
          `Denied by sensitivity policy: atoms=${deniedAtoms.map((atom) => atom.id).join(",") || "none"} artifacts=${
            deniedArtifacts.map((artifact) => artifact.id).join(",") || "none"
          }`
        );
      }

      const exportRecord: OffboardingExportRecord = {
        id: id("offboarding_export"),
        subjectPrincipalId: input.subjectPrincipalId,
        requestedBy: input.principal.id,
        status: deniedReasons.length > 0 ? "denied" : "completed",
        exportedAtomIds: deniedReasons.length > 0 ? [] : ownedAtoms.map((atom) => atom.id),
        exportedArtifactIds: deniedReasons.length > 0 ? [] : ownedArtifacts.map((artifact) => artifact.id),
        revokedAccountIds: [],
        remappedAccountIds: [],
        deniedReasons,
        createdAt: timestamp
      };

      const events: BrainEvent[] = [
        auditEvent({
          actorId: input.principal.id,
          action: "offboarding.export",
          targetId: input.subjectPrincipalId,
          targetType: "principal",
          policyDecision: exportRecord.status === "denied" ? "deny" : "allow",
          metadata: {
            exportId: exportRecord.id,
            exportedAtomIds: exportRecord.exportedAtomIds,
            exportedArtifactIds: exportRecord.exportedArtifactIds,
            deniedReasons
          },
          timestamp
        })
      ];

      if (exportRecord.status === "completed") {
        const subjectAccounts = control.connectedAccounts.filter((account) => account.principalId === input.subjectPrincipalId);
        if ((input.accountAction ?? "revoke") === "remap") {
          exportRecord.remappedAccountIds = subjectAccounts.map((account) => account.id);
          for (const account of subjectAccounts) {
            events.push(
              auditEvent({
                actorId: input.principal.id,
                action: "access.remap",
                targetId: account.id,
                targetType: "connected-account",
                policyDecision: "allow",
                metadata: {
                  subjectPrincipalId: input.subjectPrincipalId,
                  remapToPrincipalId: input.remapToPrincipalId,
                  reason: input.reason ?? "offboarding"
                },
                timestamp
              })
            );
          }
        } else {
          for (const account of subjectAccounts.filter((candidate) => candidate.status !== "revoked")) {
            if (controlPlane.revokeConnectedAccount) {
              await controlPlane.revokeConnectedAccount(account.id);
            }
            exportRecord.revokedAccountIds.push(account.id);
            events.push(
              auditEvent({
                actorId: input.principal.id,
                action: "access.revoke",
                targetId: account.id,
                targetType: "connected-account",
                policyDecision: "allow",
                metadata: {
                  subjectPrincipalId: input.subjectPrincipalId,
                  reason: input.reason ?? "offboarding"
                },
                timestamp
              })
            );
          }
        }
      }

      state.offboardingExports = [exportRecord, ...state.offboardingExports];
      state.auditEvents = [...events, ...state.auditEvents];
      await save(state);

      return { exportRecord, auditEvents: events };
    }
  };
}

export const connectorMaintenanceAssistant = createConnectorMaintenanceAssistant();
