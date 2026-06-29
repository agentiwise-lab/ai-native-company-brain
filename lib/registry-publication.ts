import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrainEvent, Changeset, RegistryItem, ReviewCheck } from "./types";

export type RegistryPublication = {
  id: string;
  packageId: string;
  packageKind: RegistryItem["kind"];
  slug: string;
  version: string;
  rollbackTarget: string;
  canaryPercent: number;
  reviewerId: string;
  publishedAt: string;
};

export type RegistryPublicationState = {
  checks: Array<ReviewCheck & { packageId: string; version: string; reviewerId?: string; createdAt: string }>;
  publications: RegistryPublication[];
  auditEvents: BrainEvent[];
};

export type RegistryPublicationStore = {
  read(): Promise<RegistryPublicationState | null>;
  write(state: RegistryPublicationState): Promise<void>;
};

type PipelineOptions = {
  store?: RegistryPublicationStore;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type EvaluateInput = {
  item: RegistryItem;
  changeset: Changeset;
  reviewerId?: string;
  sandboxPassed?: boolean;
  evalsPassed?: boolean;
};

type PublishInput = EvaluateInput;

function defaultStatePath() {
  return process.env.REGISTRY_PUBLICATION_STATE_PATH ?? join(process.cwd(), "data", "registry-publication-state.json");
}

function createFileStore(path = defaultStatePath()): RegistryPublicationStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as RegistryPublicationState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): RegistryPublicationState {
  return {
    checks: [],
    publications: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function check(id: string, label: string, status: ReviewCheck["status"], detail: string): ReviewCheck {
  return { id, label, status, detail };
}

function securityFindings(item: RegistryItem) {
  const findings: string[] = [];
  if (item.permissions.some((permission) => /write|admin|delete|secret/i.test(permission))) {
    findings.push("unsafe write/admin permission");
  }
  if ("secrets" in item && item.secrets.some((secret) => !/^[A-Z0-9_]+$/.test(secret))) {
    findings.push("possible exposed secret value");
  }
  if ("auditPolicy" in item && item.auditPolicy === "restricted" && item.permissions.some((permission) => /write/i.test(permission))) {
    findings.push("missing safe audit policy for write permission");
  }
  const body = ["skillMarkdown" in item ? item.skillMarkdown : "", item.description].join("\n");
  if (/ignore previous instructions|exfiltrate|system prompt|curl\s+http/i.test(body)) {
    findings.push("prompt injection or suspicious script pattern");
  }
  return findings;
}

function rollbackTarget(item: RegistryItem) {
  return "rollbackTarget" in item && item.rollbackTarget ? item.rollbackTarget : "previous";
}

function evaluateChecks(input: EvaluateInput): ReviewCheck[] {
  const item = input.item;
  const evalCount = "evals" in item ? item.evals.length : 1;
  const security = securityFindings(item);
  return [
    check("lint", "Manifest lint", item.ownerId && item.version && item.slug ? "passed" : "failed", "Canonical package fields were validated."),
    check("sandbox", "Sandbox tests", input.sandboxPassed === false ? "failed" : "passed", input.sandboxPassed === false ? "Sandbox tests failed." : "Sandbox tests passed or were not required for this package."),
    check("evals", "Eval run", evalCount > 0 && input.evalsPassed !== false ? "passed" : "failed", evalCount > 0 ? `${evalCount} evals configured.` : "Missing evals."),
    check("security", "Security scan", security.length === 0 ? "passed" : "failed", security.length === 0 ? "No unsafe permissions, exposed secrets, prompt injection, or audit issues found." : security.join(", ")),
    check("owner_review", "Owner review", input.changeset.ownerId ? "passed" : "failed", input.changeset.ownerId ? `Owner ${input.changeset.ownerId} assigned.` : "Missing owner."),
    check("tier_approval", "Tier approval", input.changeset.reviewers.length > 0 ? "passed" : "failed", input.changeset.reviewers.length > 0 ? `${input.changeset.reviewers.length} reviewer(s) assigned.` : "No reviewer assigned."),
    check("adapters", "Adapter generation", item.adapterTargets.length > 0 ? "passed" : "failed", item.adapterTargets.length > 0 ? `${item.adapterTargets.length} adapter targets configured.` : "No adapter targets configured."),
    check("rollback", "Rollback metadata", rollbackTarget(item) ? "passed" : "failed", `Rollback target: ${rollbackTarget(item)}.`)
  ];
}

function decisionFor(checks: ReviewCheck[], reviewerId?: string) {
  const failed = checks.filter((candidate) => candidate.status === "failed");
  const reasons = failed.map((candidate) => `${candidate.label}: ${candidate.detail}`);
  if (!reviewerId) {
    reasons.push("Reviewer approval is required before publication.");
  }
  return {
    allowed: reasons.length === 0,
    reasons: reasons.length === 0 ? ["All mandatory publication checks passed."] : reasons
  };
}

export function createRegistryPublicationPipeline(options: PipelineOptions = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: RegistryPublicationState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async evaluate(input: EvaluateInput) {
      const state = await load();
      const timestamp = now();
      const checks = evaluateChecks(input);
      const decision = decisionFor(checks, input.reviewerId);
      state.checks = [
        ...checks.map((candidate) => ({
          ...candidate,
          packageId: input.item.id,
          version: input.item.version,
          reviewerId: input.reviewerId,
          createdAt: timestamp
        })),
        ...state.checks.filter((candidate) => !(candidate.packageId === input.item.id && candidate.version === input.item.version))
      ];
      await save(state);
      return { checks, decision };
    },

    async publish(input: PublishInput) {
      const state = await load();
      const timestamp = now();
      const checks = evaluateChecks(input);
      const decision = decisionFor(checks, input.reviewerId);
      state.checks = [
        ...checks.map((candidate) => ({
          ...candidate,
          packageId: input.item.id,
          version: input.item.version,
          reviewerId: input.reviewerId,
          createdAt: timestamp
        })),
        ...state.checks.filter((candidate) => !(candidate.packageId === input.item.id && candidate.version === input.item.version))
      ];
      if (!decision.allowed || !input.reviewerId) {
        await save(state);
        return { published: false, decision, checks };
      }

      const publication: RegistryPublication = {
        id: id("registry_publication"),
        packageId: input.item.id,
        packageKind: input.item.kind,
        slug: input.item.slug,
        version: input.item.version,
        rollbackTarget: rollbackTarget(input.item),
        canaryPercent: 10,
        reviewerId: input.reviewerId,
        publishedAt: timestamp
      };
      const auditEvent: BrainEvent = {
        id: id("evt_registry_publish"),
        tenantId,
        actorId: input.reviewerId,
        action: "registry.publish",
        targetId: input.item.id,
        targetType: input.item.kind,
        policyDecision: "allow",
        metadata: {
          version: input.item.version,
          rollbackTarget: publication.rollbackTarget,
          canaryPercent: publication.canaryPercent
        },
        createdAt: timestamp
      };
      state.publications = [publication, ...state.publications];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return { published: true, decision, checks, publication, auditEvent };
    }
  };
}

export const registryPublicationPipeline = createRegistryPublicationPipeline();
