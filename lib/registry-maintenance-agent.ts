import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateAdapterGeneration } from "./adapters";
import { registry as seedRegistry } from "./seed";
import type { BrainEvent, Changeset, Principal, RegistryItem } from "./types";

export type RegistryMaintenanceAction =
  | "review-dependency"
  | "review-policy-impact"
  | "replace-removed-tool"
  | "fix-adapter"
  | "review-evals"
  | "review-usage"
  | "review-rollback-risk";

export type RegistryMaintenanceFinding = {
  id: string;
  key: string;
  packageId: string;
  packageSlug: string;
  packageVersion: string;
  packageKind: RegistryItem["kind"];
  action: RegistryMaintenanceAction;
  evidence: string[];
  recommendedAction: string;
  risk: "low" | "medium" | "high";
  createdAt: string;
};

export type RegistryMaintenanceApproval = {
  id: string;
  findingKey: string;
  reviewerContext: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type RegistryMaintenanceScan = {
  id: string;
  status: "succeeded" | "needs-approval";
  findingCount: number;
  changesetCount: number;
  duplicatesSuppressed: number;
  createdAt: string;
};

export type RegistryMaintenanceState = {
  scans: RegistryMaintenanceScan[];
  findings: RegistryMaintenanceFinding[];
  changesets: Changeset[];
  approvals: RegistryMaintenanceApproval[];
  auditEvents: BrainEvent[];
};

export type RegistryMaintenanceStore = {
  read(): Promise<RegistryMaintenanceState | null>;
  write(state: RegistryMaintenanceState): Promise<void>;
};

type DependencyChange = { dependencyId: string; changeType: string };
type PolicyChange = { atomId: string; policyType: string };
type ComposioChange = { toolkitSlug: string; removedActions: string[] };

export type RegistryMaintenanceScanInput = {
  principal: Principal;
  dependencyChanges?: DependencyChange[];
  policyChanges?: PolicyChange[];
  composioChanges?: ComposioChange[];
  evalScores?: Record<string, number>;
  usage?: Record<string, { current: number; previous: number }>;
  rollbackRisk?: Record<string, number>;
  requireApprovalForRisky?: boolean;
};

type AgentOptions = {
  store?: RegistryMaintenanceStore;
  registryItems?: RegistryItem[];
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

function defaultStatePath() {
  return process.env.REGISTRY_MAINTENANCE_STATE_PATH ?? join(process.cwd(), "data", "registry-maintenance-state.json");
}

function createFileStore(path = defaultStatePath()): RegistryMaintenanceStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as RegistryMaintenanceState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): RegistryMaintenanceState {
  return {
    scans: [],
    findings: [],
    changesets: [],
    approvals: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function references(item: RegistryItem, id: string) {
  return item.dependencies.includes(id) || item.requiredTools.includes(id);
}

function hasUsageDrop(signal?: { current: number; previous: number }) {
  if (!signal || signal.previous <= 0) {
    return false;
  }
  const droppedShare = (signal.previous - signal.current) / signal.previous;
  return (signal.previous >= 10 && droppedShare >= 0.5) || (signal.previous >= 5 && signal.current === 0);
}

function findingKey(action: RegistryMaintenanceAction, item: RegistryItem, evidence: string[]) {
  return `${action}:${item.id}:${[...evidence].sort().join("|")}`;
}

function asFinding(input: {
  id: string;
  item: RegistryItem;
  action: RegistryMaintenanceAction;
  evidence: string[];
  recommendedAction: string;
  risk: RegistryMaintenanceFinding["risk"];
  createdAt: string;
}): RegistryMaintenanceFinding {
  return {
    id: input.id,
    key: findingKey(input.action, input.item, input.evidence),
    packageId: input.item.id,
    packageSlug: input.item.slug,
    packageVersion: input.item.version,
    packageKind: input.item.kind,
    action: input.action,
    evidence: input.evidence,
    recommendedAction: input.recommendedAction,
    risk: input.risk,
    createdAt: input.createdAt
  };
}

export function createRegistryMaintenanceAgent(options: AgentOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: RegistryMaintenanceState) {
    await store.write(state);
  }

  function changesetFor(finding: RegistryMaintenanceFinding, principal: Principal, timestamp: string): Changeset {
    return {
      id: id("cs_registry_maintenance"),
      tenantId,
      title: `${finding.recommendedAction}: ${finding.packageSlug}@${finding.packageVersion}`,
      targetType: finding.packageKind,
      targetId: finding.packageId,
      tier: registryItems.find((item) => item.id === finding.packageId)?.tier ?? "team",
      authorId: principal.id,
      ownerId: registryItems.find((item) => item.id === finding.packageId)?.ownerId ?? principal.id,
      reviewers: ["usr_reviewer"],
      status: "review",
      summary: `${finding.action} for ${finding.packageSlug}@${finding.packageVersion}. Evidence: ${finding.evidence.join(", ")}. Recommended action: ${finding.recommendedAction}.`,
      checks: [
        {
          id: "maintenance_evidence",
          label: "Maintenance evidence",
          status: finding.evidence.length > 0 ? "passed" : "failed",
          detail: finding.evidence.join(", ")
        },
        {
          id: "risk",
          label: "Risk",
          status: finding.risk === "high" ? "warning" : "passed",
          detail: finding.risk
        }
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function detect(input: RegistryMaintenanceScanInput, timestamp: string) {
    const findings: RegistryMaintenanceFinding[] = [];

    for (const change of input.dependencyChanges ?? []) {
      for (const item of registryItems.filter((candidate) => references(candidate, change.dependencyId))) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "review-dependency",
            evidence: [change.dependencyId, change.changeType],
            recommendedAction: "Review dependency contract and rerun package evals",
            risk: "medium",
            createdAt: timestamp
          })
        );
      }
    }

    for (const change of input.policyChanges ?? []) {
      for (const item of registryItems.filter((candidate) => references(candidate, change.atomId))) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "review-policy-impact",
            evidence: [change.atomId, change.policyType],
            recommendedAction: "Review policy impact before promotion",
            risk: "high",
            createdAt: timestamp
          })
        );
      }
    }

    for (const change of input.composioChanges ?? []) {
      const removed = new Set(change.removedActions);
      const affectedTools = registryItems.filter(
        (item) =>
          item.kind === "tool" &&
          ("toolType" in item ? item.toolType === "connector" : false) &&
          (item.slug.includes(change.toolkitSlug) || item.permissions.some((permission) => permission.includes(`composio:${change.toolkitSlug}:`)) || removed.has(item.slug))
      );
      for (const item of affectedTools) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "replace-removed-tool",
            evidence: [change.toolkitSlug, ...change.removedActions],
            recommendedAction: "Replace removed Composio action and update dependent packages",
            risk: "high",
            createdAt: timestamp
          })
        );
      }
      for (const tool of affectedTools) {
        for (const item of registryItems.filter((candidate) => references(candidate, tool.id) || references(candidate, tool.slug))) {
          findings.push(
            asFinding({
              id: id("registry_finding"),
              item,
              action: "replace-removed-tool",
              evidence: [tool.id, tool.slug, ...change.removedActions],
              recommendedAction: "Update dependency on removed Composio action",
              risk: "high",
              createdAt: timestamp
            })
          );
        }
      }
    }

    const deprecatedTools = registryItems.filter((item) => item.kind === "tool" && item.status === "deprecated");
    for (const deprecatedTool of deprecatedTools) {
      for (const item of registryItems.filter(
        (candidate) =>
          candidate.id !== deprecatedTool.id && (references(candidate, deprecatedTool.id) || references(candidate, deprecatedTool.slug))
      )) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "review-dependency",
            evidence: [`deprecated-tool:${deprecatedTool.id}`, deprecatedTool.slug, deprecatedTool.version],
            recommendedAction: "Replace deprecated tool dependency before promotion",
            risk: "medium",
            createdAt: timestamp
          })
        );
      }
    }

    for (const item of registryItems) {
      const adapter = validateAdapterGeneration(item, registryItems);
      if (!adapter.ok) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "fix-adapter",
            evidence: adapter.errors,
            recommendedAction: "Fix adapter generation before promotion",
            risk: "high",
            createdAt: timestamp
          })
        );
      }
      const evalScore = input.evalScores?.[item.id];
      if (typeof evalScore === "number" && evalScore < 70) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "review-evals",
            evidence: [`evalScore:${evalScore}`],
            recommendedAction: "Improve eval pass rate before promotion",
            risk: "medium",
            createdAt: timestamp
          })
        );
      }
      const usage = input.usage?.[item.id];
      if (usage && hasUsageDrop(usage)) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "review-usage",
            evidence: [`usage:${usage.previous}->${usage.current}`],
            recommendedAction: "Review usage drop and retire, refresh, or re-promote package",
            risk: usage.current === 0 ? "medium" : "low",
            createdAt: timestamp
          })
        );
      }
      const rollbackRisk = input.rollbackRisk?.[item.id];
      if (typeof rollbackRisk === "number" && rollbackRisk >= 70) {
        findings.push(
          asFinding({
            id: id("registry_finding"),
            item,
            action: "review-rollback-risk",
            evidence: [`rollbackRisk:${rollbackRisk}`],
            recommendedAction: "Review rollback risk and require owner approval before promotion",
            risk: rollbackRisk >= 85 ? "high" : "medium",
            createdAt: timestamp
          })
        );
      }
    }

    return findings;
  }

  return {
    async getState() {
      return load();
    },

    async scan(input: RegistryMaintenanceScanInput) {
      const state = await load();
      const timestamp = now();
      const findings = detect(input, timestamp);
      const openKeys = new Set(
        state.findings
          .filter((finding) => state.changesets.some((changeset) => changeset.targetId === finding.packageId && changeset.status === "review"))
          .map((finding) => finding.key)
      );
      for (const approval of state.approvals.filter((approval) => approval.status === "pending")) {
        openKeys.add(approval.findingKey);
      }
      const fresh = findings.filter((finding) => !openKeys.has(finding.key));
      const duplicatesSuppressed = findings.length - fresh.length;
      const risky = fresh.filter((finding) => finding.risk === "high");
      const approvals =
        input.requireApprovalForRisky && risky.length > 0
          ? risky.map((finding) => ({
              id: id("registry_maintenance_approval"),
              findingKey: finding.key,
              reviewerContext: `${finding.packageSlug}@${finding.packageVersion}: ${finding.evidence.join(", ")}`,
              status: "pending" as const,
              createdAt: timestamp
            }))
          : [];
      const changeable = approvals.length > 0 ? fresh.filter((finding) => finding.risk !== "high") : fresh;
      const changesets = changeable.map((finding) => changesetFor(finding, input.principal, timestamp));
      const scan: RegistryMaintenanceScan = {
        id: id("registry_maintenance_scan"),
        status: approvals.length > 0 ? "needs-approval" : "succeeded",
        findingCount: findings.length,
        changesetCount: changesets.length,
        duplicatesSuppressed,
        createdAt: timestamp
      };
      const auditEvent: BrainEvent = {
        id: id("evt_registry_maintenance"),
        tenantId,
        actorId: input.principal.id,
        action: "changeset.open",
        targetId: scan.id,
        targetType: "changeset",
        policyDecision: approvals.length > 0 ? "needs-approval" : "allow",
        metadata: {
          findingCount: findings.length,
          changesetCount: changesets.length,
          duplicatesSuppressed
        },
        createdAt: timestamp
      };
      state.scans = [scan, ...state.scans];
      state.findings = [...fresh, ...state.findings];
      state.changesets = [...changesets, ...state.changesets];
      state.approvals = [...approvals, ...state.approvals];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);

      return { scan, findings: fresh, changesets, approvals, duplicatesSuppressed, auditEvent };
    }
  };
}

export const registryMaintenanceAgent = createRegistryMaintenanceAgent();
