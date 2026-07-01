import type {
  BrainEvent,
  Changeset,
  CronRun,
  DashboardSnapshot,
  DependencyEdge,
  KnowledgeAtom,
  Principal,
  QualityScore,
  RegistryItem,
  SourceArtifact
} from "./types";
import { createDefaultOperatorPackages } from "./default-operators";

export const now = "2026-06-29T10:30:00.000Z";

export const principals: Principal[] = [
  {
    id: "usr_admin",
    name: "Asha Rao",
    email: "asha@example.com",
    role: "admin",
    teams: ["platform", "revenue", "exec"],
    tiers: ["individual", "team", "department", "company-main", "exec-protected"],
    scopes: ["brain:read", "brain:write", "registry:publish", "cron:run", "audit:read"]
  },
  {
    id: "usr_reviewer",
    name: "Maya Chen",
    email: "maya@example.com",
    role: "reviewer",
    teams: ["platform", "revenue"],
    tiers: ["individual", "team", "department", "company-main"],
    scopes: ["brain:read", "brain:write", "registry:review", "cron:run", "audit:read"]
  },
  {
    id: "agent_codex",
    name: "Codex registry agent",
    email: "codex-agent@example.com",
    role: "agent",
    teams: ["platform"],
    tiers: ["individual", "team", "department", "company-main"],
    scopes: ["brain:read", "registry:read", "cron:run"]
  }
];

export const artifacts: SourceArtifact[] = [
  {
    id: "src_001",
    tenantId: "tenant_demo",
    sourceType: "meeting",
    title: "AI-native pilot kickoff transcript",
    uri: "s3://brain-artifacts/meetings/pilot-kickoff.vtt",
    ownerId: "usr_reviewer",
    tier: "team",
    sensitivity: "internal",
    capturedAt: "2026-06-28T17:00:00.000Z",
    checksum: "sha256:meeting001"
  },
  {
    id: "src_002",
    tenantId: "tenant_demo",
    sourceType: "docs",
    title: "Revenue onboarding playbook",
    uri: "https://docs.example.com/revenue/onboarding",
    ownerId: "usr_reviewer",
    tier: "department",
    sensitivity: "internal",
    capturedAt: "2026-06-26T09:00:00.000Z",
    checksum: "sha256:doc002"
  },
  {
    id: "src_003",
    tenantId: "tenant_demo",
    sourceType: "agent-transcript",
    title: "Codex skill packaging transcript",
    uri: "s3://brain-artifacts/agents/codex-skill-packaging.jsonl",
    ownerId: "usr_admin",
    tier: "team",
    sensitivity: "confidential",
    capturedAt: "2026-06-29T07:45:00.000Z",
    checksum: "sha256:agent003"
  }
];

export const atoms: KnowledgeAtom[] = [
  {
    id: "atom_001",
    tenantId: "tenant_demo",
    title: "Company brain promotion gates",
    body: "Knowledge must pass owner assignment, evidence checks, reviewer approval, and conflict resolution before it can merge into company-main.",
    atomType: "policy",
    tier: "company-main",
    ownerId: "usr_admin",
    sourceIds: ["src_001"],
    acl: {
      teams: ["platform", "revenue"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    status: "approved",
    version: 3,
    confidence: 0.94,
    freshness: 0.91,
    reviewDueAt: "2026-07-29T00:00:00.000Z",
    createdAt: "2026-06-20T10:00:00.000Z",
    updatedAt: "2026-06-28T17:30:00.000Z",
    tags: ["governance", "promotion", "company-main"]
  },
  {
    id: "atom_002",
    tenantId: "tenant_demo",
    title: "Revenue onboarding answer style",
    body: "Revenue onboarding answers should cite the current playbook, include next action owners, and avoid suggesting undocumented discount policy.",
    atomType: "playbook",
    tier: "department",
    ownerId: "usr_reviewer",
    sourceIds: ["src_002"],
    acl: {
      teams: ["revenue"],
      roles: ["admin", "reviewer", "operator", "employee", "agent"],
      sensitivity: "internal"
    },
    status: "approved",
    version: 5,
    confidence: 0.89,
    freshness: 0.84,
    reviewDueAt: "2026-07-12T00:00:00.000Z",
    createdAt: "2026-05-12T10:00:00.000Z",
    updatedAt: "2026-06-26T09:30:00.000Z",
    tags: ["revenue", "onboarding", "playbook"]
  },
  {
    id: "atom_003",
    tenantId: "tenant_demo",
    title: "Skills depend on policy atoms",
    body: "Each skill package must declare the knowledge atoms and tools it depends on so policy changes can trigger review of impacted skills.",
    atomType: "skill-dependency",
    tier: "company-main",
    ownerId: "usr_admin",
    sourceIds: ["src_003", "src_001"],
    acl: {
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "confidential"
    },
    status: "approved",
    version: 2,
    confidence: 0.92,
    freshness: 0.97,
    reviewDueAt: "2026-07-29T00:00:00.000Z",
    createdAt: "2026-06-25T12:00:00.000Z",
    updatedAt: "2026-06-29T08:00:00.000Z",
    tags: ["skills", "registry", "dependencies"]
  },
  {
    id: "atom_004",
    tenantId: "tenant_demo",
    title: "Exec hiring plan summary",
    body: "Protected hiring plan memories are available only to exec-protected principals and cannot be used in public registry skills.",
    atomType: "decision",
    tier: "exec-protected",
    ownerId: "usr_admin",
    sourceIds: ["src_001"],
    acl: {
      teams: ["exec"],
      roles: ["admin"],
      sensitivity: "restricted"
    },
    status: "candidate",
    version: 1,
    confidence: 0.71,
    freshness: 0.9,
    reviewDueAt: "2026-07-06T00:00:00.000Z",
    createdAt: "2026-06-29T09:20:00.000Z",
    updatedAt: "2026-06-29T09:20:00.000Z",
    tags: ["exec", "protected", "candidate"]
  }
];

export const registry: RegistryItem[] = [
  {
    id: "tool_brain_query",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Brain query",
    slug: "brain-query",
    description: "Retrieve governed memory and registry context with citations and ACL filtering.",
    tier: "company-main",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["brain:read"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-27T11:00:00.000Z",
    toolType: "mcp",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        tier: { type: "string" }
      },
      required: ["query"]
    },
    rateLimit: "120/minute/tenant",
    secrets: [],
    auditPolicy: "log-metadata"
  },
  ...createDefaultOperatorPackages({ ownerId: "usr_admin", updatedAt: "2026-06-30T12:00:00.000Z" }),
  {
    id: "plugin_agent_registry",
    tenantId: "tenant_demo",
    kind: "plugin",
    name: "Agent registry compatibility pack",
    slug: "agent-registry-compatibility-pack",
    description: "Publishes approved skills and MCP tools to Codex, Claude Code, OpenCode, and generic agents.",
    tier: "department",
    ownerId: "usr_admin",
    version: "0.5.0",
    status: "review",
    permissions: ["registry:read", "registry:install"],
    dependencies: ["skill_onboarding_brief", "tool_brain_query"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-29T09:00:00.000Z",
    includes: ["skills", "tools", "mcp-server", "agent-instructions"],
    marketplace: "internal"
  },
  {
    id: "cron_weekly_brain_health",
    tenantId: "tenant_demo",
    kind: "cronjob",
    name: "Weekly brain health report",
    slug: "weekly-brain-health-report",
    description: "Find stale atoms, risky skills, failed cron jobs, unresolved conflicts, and review bottlenecks.",
    tier: "company-main",
    ownerId: "usr_admin",
    version: "1.1.0",
    status: "published",
    permissions: ["brain:read", "registry:read", "audit:read"],
    dependencies: ["atom_001", "tool_brain_query"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-28T10:00:00.000Z",
    schedule: "0 9 * * MON",
    timezone: "Asia/Kolkata",
    agentRunner: "generic-mcp",
    prompt: "Produce a weekly brain health report with stale atoms, unresolved conflicts, registry drift, failed cron jobs, and recommended changesets.",
    allowedTools: ["tool_brain_query"],
    dataScopes: ["company-main", "department", "team"],
    budgetUsd: 8,
    retryPolicy: "exponential",
    maxRuntimeSeconds: 900,
    approvalGates: ["restricted-data-export"],
    outputDestination: "slack://platform/brain-health"
  },
  {
    id: "policy_tool_safety",
    tenantId: "tenant_demo",
    kind: "policy",
    name: "Tool safety review",
    slug: "tool-safety-review",
    description: "Blocks tools that request write access, secrets, or unrestricted shell execution without reviewer approval.",
    tier: "company-main",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["policy:read"],
    dependencies: ["atom_001"],
    requiredTools: [],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-25T08:00:00.000Z",
    policyType: "tool-safety",
    rules: [
      "Local CLI tools require sandbox policy.",
      "Secrets must be referenced by name, never embedded.",
      "Write tools require approval for department and higher tiers."
    ]
  }
];

export const changesets: Changeset[] = [
  {
    id: "cs_101",
    tenantId: "tenant_demo",
    title: "Promote agent registry compatibility pack",
    targetType: "plugin",
    targetId: "plugin_agent_registry",
    tier: "department",
    authorId: "agent_codex",
    ownerId: "usr_admin",
    reviewers: ["usr_reviewer"],
    status: "review",
    summary: "Adds generated adapters for Codex, Claude Code, OpenCode, and generic MCP clients.",
    checks: [
      {
        id: "check_owner",
        label: "Owner assigned",
        status: "passed",
        detail: "Asha Rao owns the package."
      },
      {
        id: "check_adapters",
        label: "Adapter generation",
        status: "passed",
        detail: "All four target manifests generated."
      },
      {
        id: "check_evals",
        label: "Skill eval coverage",
        status: "warning",
        detail: "OpenCode permission eval is present but has only one example."
      }
    ],
    createdAt: "2026-06-29T09:05:00.000Z",
    updatedAt: "2026-06-29T09:30:00.000Z"
  },
  {
    id: "cs_102",
    tenantId: "tenant_demo",
    title: "Review exec-protected hiring atom",
    targetType: "atom",
    targetId: "atom_004",
    tier: "exec-protected",
    authorId: "agent_codex",
    ownerId: "usr_admin",
    reviewers: ["usr_admin"],
    status: "blocked",
    summary: "Candidate atom includes restricted information and needs explicit exec reviewer confirmation.",
    checks: [
      {
        id: "check_acl",
        label: "ACL inheritance",
        status: "passed",
        detail: "Derived memory inherits restricted sensitivity."
      },
      {
        id: "check_reviewers",
        label: "Reviewer coverage",
        status: "failed",
        detail: "Only one exec-protected reviewer is configured."
      }
    ],
    createdAt: "2026-06-29T09:25:00.000Z",
    updatedAt: "2026-06-29T09:40:00.000Z"
  }
];

export const cronRuns: CronRun[] = [
  {
    id: "run_701",
    cronJobId: "cron_weekly_brain_health",
    status: "succeeded",
    startedAt: "2026-06-29T09:00:00.000Z",
    finishedAt: "2026-06-29T09:03:21.000Z",
    durationMs: 201000,
    output: "Found 2 stale atoms, 1 blocked changeset, and 1 registry package awaiting review.",
    auditEventIds: ["evt_001", "evt_002"]
  },
  {
    id: "run_702",
    cronJobId: "cron_weekly_brain_health",
    status: "needs-approval",
    startedAt: "2026-06-29T10:00:00.000Z",
    output: "Restricted export gate requires admin approval before posting to Slack.",
    auditEventIds: ["evt_003"]
  }
];

export const qualityScores: QualityScore[] = [
  {
    id: "qs_atom_001",
    subjectId: "atom_001",
    subjectType: "atom",
    score: 94,
    evidenceStrength: 94,
    freshness: 91,
    specificity: 93,
    actionability: 96,
    conflictRisk: 7,
    reuse: 82,
    reviewerTrust: 95,
    retractionPenalty: 0,
    notes: ["Strong source linkage", "High downstream reuse"]
  },
  {
    id: "qs_skill_onboarding",
    subjectId: "skill_onboarding_brief",
    subjectType: "skill",
    score: 88,
    evidenceStrength: 86,
    freshness: 90,
    specificity: 89,
    actionability: 91,
    conflictRisk: 12,
    reuse: 76,
    reviewerTrust: 88,
    retractionPenalty: 2,
    notes: ["Needs another OpenCode permission eval"]
  },
  {
    id: "qs_cron_health",
    subjectId: "cron_weekly_brain_health",
    subjectType: "cronjob",
    score: 83,
    evidenceStrength: 80,
    freshness: 88,
    specificity: 84,
    actionability: 87,
    conflictRisk: 18,
    reuse: 70,
    reviewerTrust: 84,
    retractionPenalty: 0,
    notes: ["Output gate created one approval hold"]
  }
];

export const edges: DependencyEdge[] = [
  {
    id: "edge_001",
    fromId: "skill_onboarding_brief",
    toId: "atom_001",
    relation: "depends-on"
  },
  {
    id: "edge_002",
    fromId: "skill_onboarding_brief",
    toId: "atom_002",
    relation: "depends-on"
  },
  {
    id: "edge_003",
    fromId: "cron_weekly_brain_health",
    toId: "tool_brain_query",
    relation: "depends-on"
  },
  {
    id: "edge_004",
    fromId: "atom_004",
    toId: "atom_001",
    relation: "depends-on"
  }
];

export const events: BrainEvent[] = [
  {
    id: "evt_001",
    tenantId: "tenant_demo",
    actorId: "agent_codex",
    action: "cron.run",
    targetId: "run_701",
    targetType: "cron-run",
    policyDecision: "allow",
    metadata: { cronJobId: "cron_weekly_brain_health" },
    createdAt: "2026-06-29T09:00:00.000Z"
  },
  {
    id: "evt_002",
    tenantId: "tenant_demo",
    actorId: "agent_codex",
    action: "answer",
    targetId: "atom_001",
    targetType: "atom",
    policyDecision: "allow",
    metadata: { citations: ["atom_001", "atom_003"] },
    createdAt: "2026-06-29T09:03:21.000Z"
  },
  {
    id: "evt_003",
    tenantId: "tenant_demo",
    actorId: "agent_codex",
    action: "cron.run",
    targetId: "run_702",
    targetType: "cron-run",
    policyDecision: "needs-approval",
    metadata: { gate: "restricted-data-export" },
    createdAt: "2026-06-29T10:00:00.000Z"
  }
];

export function getDashboardSnapshot(): DashboardSnapshot {
  const principal = principals[0];

  const tiers = principal.tiers.map((tier) => ({
    tier,
    atomCount: atoms.filter((atom) => atom.tier === tier).length,
    registryCount: registry.filter((item) => item.tier === tier).length,
    staleCount: atoms.filter((atom) => atom.tier === tier && atom.status === "stale").length,
    openChangesets: changesets.filter(
      (changeset) =>
        changeset.tier === tier &&
        !["merged", "rolled-back"].includes(changeset.status)
    ).length
  }));

  return {
    principal,
    tiers,
    atoms,
    registry,
    changesets,
    cronRuns,
    qualityScores,
    events
  };
}
