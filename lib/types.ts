export const brainTiers = [
  "individual",
  "team",
  "department",
  "company-main",
  "exec-protected",
  "regulated"
] as const;

export type BrainTier = (typeof brainTiers)[number];

export const registryKinds = [
  "tool",
  "skill",
  "plugin",
  "cronjob",
  "agent",
  "policy"
] as const;

export type RegistryKind = (typeof registryKinds)[number];

export const changesetStatuses = [
  "draft",
  "checks-running",
  "blocked",
  "review",
  "approved",
  "merged",
  "rolled-back"
] as const;

export type ChangesetStatus = (typeof changesetStatuses)[number];

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";

export type Principal = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "reviewer" | "operator" | "employee" | "agent";
  teams: string[];
  tiers: BrainTier[];
  scopes: string[];
};

export type SourceArtifact = {
  id: string;
  tenantId: string;
  sourceType:
    | "slack"
    | "email"
    | "docs"
    | "meeting"
    | "ticket"
    | "crm"
    | "code"
    | "agent-transcript";
  title: string;
  uri: string;
  ownerId: string;
  tier: BrainTier;
  sensitivity: Sensitivity;
  capturedAt: string;
  checksum: string;
};

export type KnowledgeAtom = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  atomType:
    | "claim"
    | "decision"
    | "policy"
    | "procedure"
    | "playbook"
    | "preference"
    | "lesson"
    | "entity"
    | "project"
    | "skill-dependency";
  tier: BrainTier;
  ownerId: string;
  sourceIds: string[];
  acl: {
    teams: string[];
    roles: Principal["role"][];
    sensitivity: Sensitivity;
  };
  status: "candidate" | "approved" | "stale" | "superseded" | "rejected";
  version: number;
  confidence: number;
  freshness: number;
  reviewDueAt: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

export type DependencyEdge = {
  id: string;
  fromId: string;
  toId: string;
  relation:
    | "source"
    | "supersedes"
    | "contradicts"
    | "depends-on"
    | "used-by-skill"
    | "owned-by"
    | "reviewed-by";
};

export type QualityScore = {
  id: string;
  subjectId: string;
  subjectType: "atom" | RegistryKind;
  score: number;
  evidenceStrength: number;
  freshness: number;
  specificity: number;
  actionability: number;
  conflictRisk: number;
  reuse: number;
  reviewerTrust: number;
  retractionPenalty: number;
  notes: string[];
};

export type RegistryItemBase = {
  id: string;
  tenantId: string;
  kind: RegistryKind;
  name: string;
  slug: string;
  description: string;
  tier: BrainTier;
  ownerId: string;
  version: string;
  status: "draft" | "review" | "approved" | "published" | "deprecated" | "blocked";
  permissions: string[];
  dependencies: string[];
  requiredTools: string[];
  adapterTargets: AgentTarget[];
  updatedAt: string;
};

export type SkillPackage = RegistryItemBase & {
  kind: "skill";
  skillMarkdown: string;
  evals: string[];
  examples: string[];
  changelog: string[];
  rollbackTarget?: string;
};

export type ToolDefinition = RegistryItemBase & {
  kind: "tool";
  toolType: "mcp" | "http" | "local-cli" | "workflow" | "connector" | "sandboxed-script";
  inputSchema: Record<string, unknown>;
  rateLimit: string;
  secrets: string[];
  auditPolicy: "log-metadata" | "log-input-output" | "restricted";
};

export type PluginPackage = RegistryItemBase & {
  kind: "plugin";
  includes: string[];
  marketplace: "internal" | "public" | "partner";
};

export type CronJobDefinition = RegistryItemBase & {
  kind: "cronjob";
  schedule: string;
  timezone: string;
  agentRunner: AgentTarget;
  prompt: string;
  allowedTools: string[];
  dataScopes: string[];
  budgetUsd: number;
  retryPolicy: "none" | "linear" | "exponential";
  maxRuntimeSeconds: number;
  approvalGates: string[];
  outputDestination: string;
};

export type AgentDefinition = RegistryItemBase & {
  kind: "agent";
  modelPolicy: string;
  defaultTools: string[];
  defaultSkills: string[];
};

export type PolicyDefinition = RegistryItemBase & {
  kind: "policy";
  policyType: "acl" | "retention" | "review" | "budget" | "tool-safety";
  rules: string[];
};

export type RegistryItem =
  | SkillPackage
  | ToolDefinition
  | PluginPackage
  | CronJobDefinition
  | AgentDefinition
  | PolicyDefinition;

export type AgentTarget = "codex" | "claude-code" | "opencode" | "generic-mcp";

export type Changeset = {
  id: string;
  tenantId: string;
  title: string;
  targetType: "atom" | RegistryKind;
  targetId: string;
  tier: BrainTier;
  authorId: string;
  ownerId: string;
  reviewers: string[];
  status: ChangesetStatus;
  checks: ReviewCheck[];
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewCheck = {
  id: string;
  label: string;
  status: "passed" | "failed" | "warning" | "pending";
  detail: string;
};

export type CronRun = {
  id: string;
  cronJobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "needs-approval";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  output: string;
  auditEventIds: string[];
};

export type BrainEvent = {
  id: string;
  tenantId: string;
  actorId: string;
  action:
    | "ingest"
    | "extract"
    | "query"
    | "answer"
    | "changeset.open"
    | "review"
    | "merge"
    | "rollback"
    | "cron.run"
    | "registry.publish"
    | "tool.invoke"
    | "export"
    | "connector.triage"
    | "offboarding.export"
    | "access.revoke"
    | "access.remap"
    | "identity.configure"
    | "identity.scim.sync"
    | "retention.configure"
    | "retention.run"
    | "legal-hold.apply"
    | "legal-hold.release"
    | "answer.audit-pack"
    | "ops.telemetry"
    | "ops.health"
    | "backup.create"
    | "backup.restore"
    | "migration.recover"
    | "cloud.tenant.provision"
    | "cloud.tenant.rollback"
    | "cloud.access.check"
    | "cloud.secret.rotate"
    | "cloud.export"
    | "managed-ops.usage.record"
    | "managed-ops.plan.block"
    | "managed-ops.support.view"
    | "managed-ops.worker.recover"
    | "managed-ops.upgrade.plan"
    | "marketplace.review"
    | "marketplace.install.open"
    | "marketplace.install.block"
    | "marketplace.install.rollback";
  targetId: string;
  targetType:
    | "artifact"
    | "atom"
    | "changeset"
    | RegistryKind
    | "cron-run"
    | "connector"
    | "connected-account"
    | "principal"
    | "identity"
    | "retention-policy"
    | "legal-hold"
    | "export"
    | "answer-audit-pack"
    | "ops"
    | "backup"
    | "restore"
    | "migration"
    | "cloud-tenant"
    | "cloud-secret";
  policyDecision: "allow" | "deny" | "needs-approval";
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BrainQueryResult = {
  answer: string;
  citations: KnowledgeAtom[];
  events: BrainEvent[];
  retrievedRegistry: RegistryItem[];
  retrieval: {
    explanation: string;
    rankings: Array<{
      atomId: string;
      score: number;
      factors: {
        lexical: number;
        vector: number;
        metadata: number;
        graph: number;
        tierAuthority: number;
        freshness: number;
        confidence: number;
        status: number;
        quality: number;
      };
    }>;
    denied: Array<{
      atomId: string;
      reason: string;
      score: number;
    }>;
  };
  policy: {
    allowed: boolean;
    reasons: string[];
  };
};

export type DashboardSnapshot = {
  principal: Principal;
  tiers: Array<{
    tier: BrainTier;
    atomCount: number;
    registryCount: number;
    staleCount: number;
    openChangesets: number;
  }>;
  atoms: KnowledgeAtom[];
  registry: RegistryItem[];
  changesets: Changeset[];
  cronRuns: CronRun[];
  qualityScores: QualityScore[];
  events: BrainEvent[];
};
