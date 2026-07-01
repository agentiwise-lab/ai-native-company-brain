import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brainTiers, type BrainTier } from "./types";
import { createDefaultOperatorPackages } from "./default-operators";

export type OnboardingMode = "supabase-local" | "supabase-cloud" | "demo";
export type OnboardingStatus = "not-started" | "draft" | "plan-ready" | "active" | "blocked";
export type SetupTaskStatus = "pending" | "running" | "completed" | "blocked";
export type SetupRecommendationStatus = "pending" | "approved" | "rejected";
export type OrgUnitKind = "company" | "department" | "team" | "exec-protected" | "regulated";
export type ConnectorPreflightStatus = "not-configured" | "needs-scope" | "ready" | "blocked";
export type SupabasePreflightStatus = "passed" | "warning" | "failed" | "skipped";

export type SetupTenant = {
  id: string;
  name: string;
  createdAt: string;
};

export type SetupAdmin = {
  id: "usr_admin";
  name: string;
  email: string;
  role: "admin";
  createdAt: string;
};

export type SetupSettings = {
  encryptionKeyConfigured: boolean;
  composioProjectId: string;
  composioApiKeyConfigured: boolean;
  createdAt: string;
};

export type SetupAuditEvent = {
  id: string;
  action:
    | "tenant.bootstrap"
    | "admin.bootstrap"
    | "onboarding.plan.generated"
    | "onboarding.plan.approved"
    | "onboarding.activation.blocked";
  actorId: string;
  targetId: string;
  metadata: Record<string, string | boolean | string[]>;
  createdAt: string;
};

export type OnboardingProfile = {
  mode: OnboardingMode;
  status: OnboardingStatus;
  currentStep: "mode" | "describe" | "connect" | "preview" | "review" | "activate";
  companyDescription: string;
  goals: string[];
  challenges: string[];
  sensitiveAreas: string[];
  selectedConnectors: string[];
  selectedBrainTiers: BrainTier[];
  supabaseProjectRef?: string;
  supabaseProjectUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrgUnit = {
  id: string;
  kind: OrgUnitKind;
  name: string;
  parentId?: string;
  ownerId: string;
  reviewerIds: string[];
  tier: BrainTier;
  confidence: number;
  source: "user" | "inferred" | "system";
};

export type OrgMembership = {
  id: string;
  principalId: string;
  unitId: string;
  role: "admin" | "reviewer" | "operator" | "employee" | "agent";
  teamAliases: string[];
  source: "setup" | "connector" | "scim";
};

export type BrainLevelConfig = {
  tier: BrainTier;
  label: string;
  enabled: boolean;
  ownerId?: string;
  reviewerIds: string[];
  allowedRoles: Array<"admin" | "reviewer" | "operator" | "employee" | "agent">;
  defaultSensitivity: "public" | "internal" | "confidential" | "restricted";
  activationBlockers: string[];
};

export type SetupTask = {
  id: string;
  label: string;
  status: SetupTaskStatus;
  retryable: boolean;
  error?: string;
  nextAction: string;
  updatedAt: string;
};

export type SetupRecommendation = {
  id: string;
  kind: "org-map" | "access-policy" | "default-operators" | "connector-plan" | "supabase-preflight";
  title: string;
  summary: string;
  status: SetupRecommendationStatus;
  risk: "low" | "medium" | "high";
  affectedIds: string[];
  createdAt: string;
};

export type ConnectorSourcePreview = {
  id: string;
  name: string;
  sourceType: "channel" | "docs" | "email" | "repo" | "project" | "database" | "crm" | "meeting";
  mappedUnitId: string;
  tier: BrainTier;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  risk: "low" | "medium" | "high";
  included: boolean;
  notes: string[];
};

export type ConnectorPreflight = {
  connector: string;
  status: ConnectorPreflightStatus;
  accountStatus: "pending" | "active" | "revoked" | "missing";
  requiredScopes: string[];
  missingScopes: string[];
  sourcePreviews: ConnectorSourcePreview[];
  sampleCandidateCount: number;
  approvalStatus: "pending" | "approved" | "blocked";
  nextAction: string;
};

export type SupabasePreflightCheck = {
  id: "project" | "vector" | "rls" | "storage" | "migrations" | "conflicts" | "data-api";
  label: string;
  status: SupabasePreflightStatus;
  detail: string;
};

export type SupabaseSetup = {
  mode: OnboardingMode;
  projectRef?: string;
  projectUrl?: string;
  checks: SupabasePreflightCheck[];
  ready: boolean;
};

export type SetupState = {
  isComplete: boolean;
  tenant: SetupTenant | null;
  admin: SetupAdmin | null;
  settings: SetupSettings | null;
  brainTiers: BrainTier[];
  onboarding: OnboardingProfile | null;
  orgUnits: OrgUnit[];
  orgMemberships: OrgMembership[];
  brainLevelConfigs: BrainLevelConfig[];
  setupTasks: SetupTask[];
  setupRecommendations: SetupRecommendation[];
  connectorPreflights: ConnectorPreflight[];
  supabase: SupabaseSetup | null;
  auditEvents: SetupAuditEvent[];
};

export type BootstrapTenantInput = {
  tenantName: string;
  adminName: string;
  adminEmail: string;
  encryptionKey: string;
  composioProjectId: string;
  composioApiKeyConfigured: boolean;
  mode?: OnboardingMode;
  companyDescription?: string;
  departments?: string[] | string;
  teams?: string[] | string;
  people?: string[] | string;
  goals?: string[] | string;
  challenges?: string[] | string;
  sensitiveAreas?: string[] | string;
  selectedConnectors?: string[] | string;
  selectedBrainTiers?: BrainTier[] | string;
  supabaseProjectRef?: string;
  supabaseProjectUrl?: string;
  approveSetupPlan?: boolean;
};

export type SetupStoreOptions = {
  storagePath?: string;
  now?: () => string;
};

const defaultSetupState: SetupState = {
  isComplete: false,
  tenant: null,
  admin: null,
  settings: null,
  brainTiers: [...brainTiers],
  onboarding: null,
  orgUnits: [],
  orgMemberships: [],
  brainLevelConfigs: [],
  setupTasks: [],
  setupRecommendations: [],
  connectorPreflights: [],
  supabase: null,
  auditEvents: []
};

const defaultEnabledTiers: BrainTier[] = ["individual", "team", "department", "company-main"];

const defaultConnectors = ["slack", "google-drive", "gmail", "notion", "github", "linear"];

const connectorScopes: Record<string, string[]> = {
  slack: ["channels:read", "groups:read", "users:read"],
  "google-drive": ["drive.metadata.readonly", "drive.readonly"],
  gmail: ["gmail.readonly"],
  notion: ["notion.search", "notion.read"],
  github: ["repo:read", "issues:read", "pull_requests:read"],
  linear: ["issues:read", "projects:read"],
  crm: ["crm.objects.read"],
  meetings: ["transcripts.read"]
};

function defaultStoragePath() {
  return process.env.COMPANY_BRAIN_SETUP_PATH ?? join(process.cwd(), "data", "setup-state.json");
}

function getStoragePath(options?: SetupStoreOptions) {
  return options?.storagePath ?? defaultStoragePath();
}

function timestamp(options?: SetupStoreOptions) {
  return options?.now?.() ?? new Date().toISOString();
}

function tenantIdFromName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `tenant_${slug || "default"}`;
}

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

function listFromInput(input: string[] | string | undefined, fallback: string[] = []) {
  if (Array.isArray(input)) {
    return input.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
}

function selectedTiers(input: BootstrapTenantInput) {
  if (Array.isArray(input.selectedBrainTiers)) {
    return input.selectedBrainTiers.filter((tier) => brainTiers.includes(tier));
  }
  if (typeof input.selectedBrainTiers === "string") {
    return listFromInput(input.selectedBrainTiers).filter((tier): tier is BrainTier => brainTiers.includes(tier as BrainTier));
  }
  return [...defaultEnabledTiers];
}

function tierLabel(tier: BrainTier) {
  return tier
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function validateInput(input: BootstrapTenantInput) {
  if (!input.tenantName.trim()) {
    throw new Error("Tenant name is required.");
  }
  if (!input.adminName.trim()) {
    throw new Error("Admin name is required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.adminEmail.trim())) {
    throw new Error("A valid admin email is required.");
  }
  if (!input.encryptionKey.trim()) {
    throw new Error("Encryption key is required.");
  }
  if (!input.composioProjectId.trim()) {
    throw new Error("Composio project id is required.");
  }
  if (input.mode === "supabase-cloud" && !input.supabaseProjectRef?.trim()) {
    throw new Error("Supabase project ref is required for cloud mode.");
  }
  const tiers = selectedTiers(input);
  if (tiers.length === 0) {
    throw new Error("At least one brain level must be enabled.");
  }
}

function buildOrgUnits(input: BootstrapTenantInput, tenant: SetupTenant, admin: SetupAdmin): OrgUnit[] {
  const departmentNames = listFromInput(input.departments, ["Operations", "Revenue", "Engineering"]);
  const teamNames = listFromInput(input.teams, ["Platform", "Customer Team"]);
  const selected = new Set(selectedTiers(input));
  const company: OrgUnit = {
    id: `${tenant.id}:company`,
    kind: "company",
    name: tenant.name,
    ownerId: admin.id,
    reviewerIds: [admin.id],
    tier: "company-main",
    confidence: 1,
    source: "user"
  };
  const departments = departmentNames.map<OrgUnit>((name) => ({
    id: `${tenant.id}:department:${slug(name)}`,
    kind: "department",
    name,
    parentId: company.id,
    ownerId: admin.id,
    reviewerIds: [admin.id],
    tier: "department",
    confidence: 0.82,
    source: "inferred"
  }));
  const parentDepartment = departments[0]?.id ?? company.id;
  const teams = teamNames.map<OrgUnit>((name) => ({
    id: `${tenant.id}:team:${slug(name)}`,
    kind: "team",
    name,
    parentId: parentDepartment,
    ownerId: admin.id,
    reviewerIds: [admin.id],
    tier: "team",
    confidence: 0.76,
    source: "inferred"
  }));
  const protectedUnits: OrgUnit[] = [];
  if (selected.has("exec-protected")) {
    protectedUnits.push({
      id: `${tenant.id}:exec-protected`,
      kind: "exec-protected",
      name: "Exec Protected",
      parentId: company.id,
      ownerId: admin.id,
      reviewerIds: [admin.id],
      tier: "exec-protected",
      confidence: 1,
      source: "system"
    });
  }
  if (selected.has("regulated")) {
    protectedUnits.push({
      id: `${tenant.id}:regulated`,
      kind: "regulated",
      name: "Regulated",
      parentId: company.id,
      ownerId: admin.id,
      reviewerIds: [admin.id],
      tier: "regulated",
      confidence: 1,
      source: "system"
    });
  }
  return [company, ...departments, ...teams, ...protectedUnits];
}

function buildMemberships(admin: SetupAdmin, orgUnits: OrgUnit[]): OrgMembership[] {
  return orgUnits.map((unit) => ({
    id: `${unit.id}:membership:${admin.id}`,
    principalId: admin.id,
    unitId: unit.id,
    role: "admin",
    teamAliases: unit.kind === "team" ? [unit.name] : [],
    source: "setup"
  }));
}

function buildBrainLevelConfigs(input: BootstrapTenantInput, admin: SetupAdmin): BrainLevelConfig[] {
  const selected = new Set(selectedTiers(input));
  return brainTiers.map((tier) => {
    const enabled = selected.has(tier);
    const protectedTier = tier === "exec-protected" || tier === "regulated";
    const ownerId = enabled ? admin.id : undefined;
    const reviewerIds = enabled ? [admin.id] : [];
    const activationBlockers = enabled && (!ownerId || reviewerIds.length === 0) ? [`${tier} requires an owner and reviewer.`] : [];
    return {
      tier,
      label: tierLabel(tier),
      enabled,
      ownerId,
      reviewerIds,
      allowedRoles: protectedTier ? ["admin", "reviewer"] : ["admin", "reviewer", "operator", "employee", "agent"],
      defaultSensitivity: protectedTier ? "restricted" : tier === "department" ? "confidential" : "internal",
      activationBlockers
    };
  });
}

function sourceTypeFor(connector: string): ConnectorSourcePreview["sourceType"] {
  if (connector === "slack") return "channel";
  if (connector === "gmail") return "email";
  if (connector === "github") return "repo";
  if (connector === "linear") return "project";
  if (connector === "notion") return "database";
  if (connector === "crm") return "crm";
  if (connector === "meetings") return "meeting";
  return "docs";
}

function buildConnectorPreflights(input: BootstrapTenantInput, orgUnits: OrgUnit[]): ConnectorPreflight[] {
  const connectors = listFromInput(input.selectedConnectors, defaultConnectors);
  const company = orgUnits.find((unit) => unit.kind === "company") ?? orgUnits[0];
  const firstDepartment = orgUnits.find((unit) => unit.kind === "department") ?? company;
  const firstTeam = orgUnits.find((unit) => unit.kind === "team") ?? firstDepartment;
  const sensitiveAreas = listFromInput(input.sensitiveAreas);

  return connectors.map((connector) => {
    const requiredScopes = connectorScopes[connector] ?? [`${connector}:read`];
    const missingScopes = input.composioApiKeyConfigured ? [] : ["COMPOSIO_API_KEY"];
    const mappedUnit = connector === "slack" || connector === "linear" || connector === "github" ? firstTeam : firstDepartment;
    const restricted = sensitiveAreas.some((area) => new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(connector));
    const sourcePreviews: ConnectorSourcePreview[] = [
      {
        id: `${connector}:sample:primary`,
        name: `${connector} primary source`,
        sourceType: sourceTypeFor(connector),
        mappedUnitId: mappedUnit.id,
        tier: mappedUnit.tier,
        sensitivity: restricted ? "restricted" : mappedUnit.tier === "team" ? "internal" : "confidential",
        risk: restricted ? "high" : "medium",
        included: missingScopes.length === 0,
        notes: restricted
          ? ["Restricted signal detected from sensitive setup areas.", "Quarantine into exec-protected or regulated proposals before sync."]
          : ["Sample before full sync.", "Admin must approve full backfill."]
      }
    ];
    return {
      connector,
      status: missingScopes.length > 0 ? "needs-scope" : "ready",
      accountStatus: missingScopes.length > 0 ? "missing" : "active",
      requiredScopes,
      missingScopes,
      sourcePreviews,
      sampleCandidateCount: missingScopes.length > 0 ? 0 : 3,
      approvalStatus: "pending",
      nextAction: missingScopes.length > 0 ? "Configure Composio API key and re-run connector preflight." : "Review source preview and approve sample sync."
    };
  });
}

function buildSupabaseSetup(input: BootstrapTenantInput): SupabaseSetup {
  const mode = input.mode ?? "supabase-local";
  if (mode === "demo") {
    return {
      mode,
      checks: [
        {
          id: "project",
          label: "Demo mode",
          status: "skipped",
          detail: "Seed repository is active; Supabase provisioning is skipped."
        }
      ],
      ready: true
    };
  }
  const hasProject = mode === "supabase-local" || Boolean(input.supabaseProjectRef?.trim() || input.supabaseProjectUrl?.trim());
  const checks: SupabasePreflightCheck[] = [
    {
      id: "project",
      label: "Supabase project",
      status: hasProject ? "passed" : "failed",
      detail: hasProject ? "Project target is configured." : "Provide an existing Supabase project ref for cloud setup."
    },
    {
      id: "vector",
      label: "Vector extension",
      status: "warning",
      detail: "Migration must enable extension vector with schema extensions before embedding writes."
    },
    {
      id: "rls",
      label: "Row level security",
      status: "warning",
      detail: "Setup migrations must enable RLS for exposed onboarding and brain tables."
    },
    {
      id: "storage",
      label: "Artifact storage",
      status: "warning",
      detail: "Create a tenant-scoped storage bucket/prefix for raw source artifacts."
    },
    {
      id: "migrations",
      label: "Migration history",
      status: "warning",
      detail: "Run Supabase migration status before applying setup migrations."
    },
    {
      id: "conflicts",
      label: "Existing object conflicts",
      status: "warning",
      detail: "Stop setup if existing tables conflict with the Company Brain schema."
    },
    {
      id: "data-api",
      label: "Data API exposure",
      status: "warning",
      detail: "Do not assume SQL-created tables are exposed; app APIs remain the primary access path."
    }
  ];
  return {
    mode,
    projectRef: input.supabaseProjectRef?.trim() || undefined,
    projectUrl: input.supabaseProjectUrl?.trim() || undefined,
    checks,
    ready: hasProject && checks.every((check) => check.status !== "failed")
  };
}

function buildSetupTasks(input: BootstrapTenantInput, supabase: SupabaseSetup, connectorPreflights: ConnectorPreflight[], timestamp: string): SetupTask[] {
  const approval = input.approveSetupPlan !== false;
  const blockedConnectors = connectorPreflights.filter((preflight) => preflight.status !== "ready").length;
  return [
    {
      id: "mode",
      label: "Choose operating mode",
      status: "completed",
      retryable: false,
      nextAction: `Mode selected: ${input.mode ?? "supabase-local"}.`,
      updatedAt: timestamp
    },
    {
      id: "describe",
      label: "Describe company and goals",
      status: "completed",
      retryable: true,
      nextAction: "Review inferred org map before activation.",
      updatedAt: timestamp
    },
    {
      id: "supabase-preflight",
      label: "Run Supabase preflight",
      status: supabase.ready ? "completed" : "blocked",
      retryable: true,
      error: supabase.ready ? undefined : "Supabase target is not ready.",
      nextAction: supabase.ready ? "Apply setup migrations when implementation is enabled." : "Fix Supabase project configuration.",
      updatedAt: timestamp
    },
    {
      id: "connector-preflight",
      label: "Preview connected tools",
      status: blockedConnectors > 0 ? "blocked" : "completed",
      retryable: true,
      error: blockedConnectors > 0 ? `${blockedConnectors} connector(s) need scopes or credentials.` : undefined,
      nextAction: blockedConnectors > 0 ? "Fix connector scopes before broad sync." : "Approve sample sync before full backfill.",
      updatedAt: timestamp
    },
    {
      id: "review-plan",
      label: "Review AI setup plan",
      status: approval ? "completed" : "pending",
      retryable: false,
      nextAction: approval ? "Setup plan approved." : "Approve org map, access, operators, and first sync plan.",
      updatedAt: timestamp
    },
    {
      id: "activate",
      label: "Activate first brain build",
      status: approval ? "completed" : "pending",
      retryable: false,
      nextAction: approval ? "Land in the scoped cockpit." : "Activation waits for explicit approval.",
      updatedAt: timestamp
    }
  ];
}

function buildRecommendations(input: BootstrapTenantInput, orgUnits: OrgUnit[], connectorPreflights: ConnectorPreflight[], timestamp: string): SetupRecommendation[] {
  const status: SetupRecommendationStatus = input.approveSetupPlan === false ? "pending" : "approved";
  const operators = createDefaultOperatorPackages();
  return [
    {
      id: "rec_org_map",
      kind: "org-map",
      title: "Approve inferred org map",
      summary: `${orgUnits.filter((unit) => unit.kind === "department").length} departments and ${orgUnits.filter((unit) => unit.kind === "team").length} teams are ready for review.`,
      status,
      risk: "medium",
      affectedIds: orgUnits.map((unit) => unit.id),
      createdAt: timestamp
    },
    {
      id: "rec_access_policy",
      kind: "access-policy",
      title: "Approve default access posture",
      summary: "Enabled brain levels require owners and reviewers; protected tiers stay opt-in.",
      status,
      risk: "high",
      affectedIds: selectedTiers(input),
      createdAt: timestamp
    },
    {
      id: "rec_default_operators",
      kind: "default-operators",
      title: "Install Core 12 AI operators",
      summary: `${operators.filter((operator) => operator.status === "published").length} safe operators publish immediately; ${operators.filter((operator) => operator.status === "review").length} operators require review.`,
      status,
      risk: "medium",
      affectedIds: operators.map((operator) => operator.id),
      createdAt: timestamp
    },
    {
      id: "rec_connector_plan",
      kind: "connector-plan",
      title: "Approve connector preflight plan",
      summary: `${connectorPreflights.length} connector(s) have source previews before full sync.`,
      status,
      risk: connectorPreflights.some((preflight) => preflight.status !== "ready") ? "high" : "medium",
      affectedIds: connectorPreflights.map((preflight) => preflight.connector),
      createdAt: timestamp
    }
  ];
}

function writeSetupState(path: string, state: SetupState) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tempPath, path);
}

export function getSetupState(options?: SetupStoreOptions): SetupState {
  const path = getStoragePath(options);
  if (!existsSync(path)) {
    return { ...defaultSetupState, brainTiers: [...brainTiers], auditEvents: [] };
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as SetupState;
  return {
    ...defaultSetupState,
    ...parsed,
    brainTiers: parsed.brainTiers?.length ? parsed.brainTiers : [...brainTiers],
    orgUnits: parsed.orgUnits ?? [],
    orgMemberships: parsed.orgMemberships ?? [],
    brainLevelConfigs: parsed.brainLevelConfigs ?? [],
    setupTasks: parsed.setupTasks ?? [],
    setupRecommendations: parsed.setupRecommendations ?? [],
    connectorPreflights: parsed.connectorPreflights ?? [],
    auditEvents: parsed.auditEvents ?? []
  };
}

export function bootstrapTenant(input: BootstrapTenantInput, options?: SetupStoreOptions): SetupState {
  validateInput(input);

  const path = getStoragePath(options);
  const existing = getSetupState(options);
  if (existing.isComplete) {
    throw new Error("Tenant is already bootstrapped.");
  }

  const createdAt = timestamp(options);
  const tenant: SetupTenant = {
    id: tenantIdFromName(input.tenantName),
    name: input.tenantName.trim(),
    createdAt
  };
  const admin: SetupAdmin = {
    id: "usr_admin",
    name: input.adminName.trim(),
    email: input.adminEmail.trim().toLowerCase(),
    role: "admin",
    createdAt
  };
  const settings: SetupSettings = {
    encryptionKeyConfigured: input.encryptionKey.trim().length > 0,
    composioProjectId: input.composioProjectId.trim(),
    composioApiKeyConfigured: Boolean(input.composioApiKeyConfigured),
    createdAt
  };
  const selectedBrainLevels = selectedTiers(input);
  const onboarding: OnboardingProfile = {
    mode: input.mode ?? "supabase-local",
    status: input.approveSetupPlan === false ? "plan-ready" : "active",
    currentStep: input.approveSetupPlan === false ? "review" : "activate",
    companyDescription: input.companyDescription?.trim() || `${tenant.name} is setting up an org-wide Company Brain.`,
    goals: listFromInput(input.goals, ["Build a source-backed company brain", "Make approved knowledge available to agents"]),
    challenges: listFromInput(input.challenges, ["Avoid stale knowledge", "Keep access safe across departments"]),
    sensitiveAreas: listFromInput(input.sensitiveAreas, ["exec planning", "regulated data", "customer secrets"]),
    selectedConnectors: listFromInput(input.selectedConnectors, defaultConnectors),
    selectedBrainTiers: selectedBrainLevels,
    supabaseProjectRef: input.supabaseProjectRef?.trim() || undefined,
    supabaseProjectUrl: input.supabaseProjectUrl?.trim() || undefined,
    createdAt,
    updatedAt: createdAt
  };
  const orgUnits = buildOrgUnits(input, tenant, admin);
  const orgMemberships = buildMemberships(admin, orgUnits);
  const brainLevelConfigs = buildBrainLevelConfigs(input, admin);
  const connectorPreflights = buildConnectorPreflights(input, orgUnits);
  const supabase = buildSupabaseSetup(input);
  const setupTasks = buildSetupTasks(input, supabase, connectorPreflights, createdAt);
  const setupRecommendations = buildRecommendations(input, orgUnits, connectorPreflights, createdAt);
  const activationBlockers = [
    ...brainLevelConfigs.flatMap((config) => config.activationBlockers),
    ...setupTasks.filter((task) => task.status === "blocked").map((task) => task.error ?? `${task.label} is blocked.`)
  ];
  const approved = input.approveSetupPlan !== false;
  const auditEvents: SetupAuditEvent[] = [
    {
      id: `setup_evt_${tenant.id}`,
      action: "tenant.bootstrap",
      actorId: admin.id,
      targetId: tenant.id,
      metadata: {
        tenantName: tenant.name,
        brainTiers: [...brainTiers]
      },
      createdAt
    },
    {
      id: `setup_evt_${admin.id}`,
      action: "admin.bootstrap",
      actorId: admin.id,
      targetId: admin.id,
      metadata: {
        adminEmail: admin.email,
        composioProjectId: settings.composioProjectId,
        composioApiKeyConfigured: settings.composioApiKeyConfigured
      },
      createdAt
    },
    {
      id: `setup_evt_onboarding_plan_${tenant.id}`,
      action: "onboarding.plan.generated",
      actorId: admin.id,
      targetId: tenant.id,
      metadata: {
        mode: onboarding.mode,
        selectedBrainTiers: onboarding.selectedBrainTiers,
        selectedConnectors: onboarding.selectedConnectors
      },
      createdAt
    },
    {
      id: `setup_evt_onboarding_${approved ? "approved" : "blocked"}_${tenant.id}`,
      action: approved && activationBlockers.length === 0 ? "onboarding.plan.approved" : "onboarding.activation.blocked",
      actorId: admin.id,
      targetId: tenant.id,
      metadata: {
        approved,
        blockers: activationBlockers
      },
      createdAt
    }
  ];

  const state: SetupState = {
    isComplete: approved && activationBlockers.length === 0,
    tenant,
    admin,
    settings,
    brainTiers: [...brainTiers],
    onboarding: activationBlockers.length > 0 ? { ...onboarding, status: "blocked", currentStep: "review" } : onboarding,
    orgUnits,
    orgMemberships,
    brainLevelConfigs,
    setupTasks,
    setupRecommendations,
    connectorPreflights,
    supabase,
    auditEvents
  };

  writeSetupState(path, state);
  return state;
}

export function approveSetupPlan(options?: SetupStoreOptions): SetupState {
  const path = getStoragePath(options);
  const existing = getSetupState(options);
  if (!existing.tenant || !existing.admin || !existing.onboarding) {
    throw new Error("No onboarding plan is available for approval.");
  }
  const blockers = [
    ...existing.brainLevelConfigs.flatMap((config) => config.activationBlockers),
    ...existing.setupTasks.filter((task) => task.status === "blocked" && task.id !== "connector-preflight").map((task) => task.error ?? `${task.label} is blocked.`)
  ];
  if (blockers.length > 0) {
    throw new Error(`Cannot approve onboarding plan: ${blockers.join(" ")}`);
  }
  const createdAt = timestamp(options);
  const state: SetupState = {
    ...existing,
    isComplete: true,
    onboarding: {
      ...existing.onboarding,
      status: "active",
      currentStep: "activate",
      updatedAt: createdAt
    },
    setupTasks: existing.setupTasks.map((task) =>
      task.id === "review-plan" || task.id === "activate"
        ? {
            ...task,
            status: "completed",
            nextAction: task.id === "activate" ? "Land in the scoped cockpit." : "Setup plan approved.",
            updatedAt: createdAt
          }
        : task
    ),
    setupRecommendations: existing.setupRecommendations.map((recommendation) => ({
      ...recommendation,
      status: "approved"
    })),
    auditEvents: [
      {
        id: `setup_evt_onboarding_manual_approved_${existing.tenant.id}`,
        action: "onboarding.plan.approved",
        actorId: existing.admin.id,
        targetId: existing.tenant.id,
        metadata: {
          approved: true,
          selectedBrainTiers: existing.onboarding.selectedBrainTiers
        },
        createdAt
      },
      ...existing.auditEvents
    ]
  };
  writeSetupState(path, state);
  return state;
}
