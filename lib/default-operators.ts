import type { BrainTier, Principal, SkillPackage } from "./types";

type OperatorDefinition = {
  id: string;
  name: string;
  slug: string;
  description: string;
  outcome: string;
  tier: BrainTier;
  status: "published" | "review";
  permissions: string[];
  dependencies: string[];
  version: string;
};

export const defaultOperatorDefinitions: OperatorDefinition[] = [
  {
    id: "skill_company_profile_builder",
    name: "Company profile builder",
    slug: "company-profile-builder",
    description: "Turns setup answers into a cited company profile proposal.",
    outcome: "Map company identity, goals, challenges, and operating context.",
    tier: "company-main",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_org_map_builder",
    name: "Org map builder",
    slug: "org-map-builder",
    description: "Proposes departments, teams, owners, and membership gaps from setup context.",
    outcome: "Build the first approved org map before syncing broadly.",
    tier: "company-main",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_brain_level_designer",
    name: "Brain level designer",
    slug: "brain-level-designer",
    description: "Recommends enabled brain tiers, owners, reviewers, and activation blockers.",
    outcome: "Choose which levels of brain to run and who controls each level.",
    tier: "company-main",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_connector_scope_planner",
    name: "Connector scope planner",
    slug: "connector-scope-planner",
    description: "Plans safe source scopes, backfill ranges, and connector remediation before sync.",
    outcome: "Connect work tools without accidentally over-reading sensitive sources.",
    tier: "company-main",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_onboarding_brief",
    name: "Onboarding brief",
    slug: "onboarding-brief",
    description: "Prepares cited first-week operating briefs from company-main and department playbooks.",
    outcome: "Give new hires a grounded brief with owners, glossary, checklist, and open questions.",
    tier: "company-main",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["atom_001", "atom_002", "tool_brain_query"],
    version: "1.4.0"
  },
  {
    id: "skill_automation_opportunity_finder",
    name: "Automation opportunity finder",
    slug: "automation-opportunity-finder",
    description: "Finds recurring workflows that are safe candidates for human-approved automation.",
    outcome: "See what to automate next without giving tools broad write access.",
    tier: "company-main",
    status: "published",
    permissions: ["brain:read", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_access_policy_designer",
    name: "Access policy designer",
    slug: "access-policy-designer",
    description: "Proposes ACL, RLS, reviewer, and sensitivity defaults for org units.",
    outcome: "Review access policy proposals before they affect real users or agents.",
    tier: "company-main",
    status: "review",
    permissions: ["brain:read", "registry:read", "policy:write"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_department_brain_starter",
    name: "Department brain starter",
    slug: "department-brain-starter",
    description: "Creates starter department brain proposals from approved source previews.",
    outcome: "Spin up department brains with owners, reviewers, and source-backed candidates.",
    tier: "department",
    status: "review",
    permissions: ["brain:read", "brain:write", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_team_brain_starter",
    name: "Team brain starter",
    slug: "team-brain-starter",
    description: "Creates starter team brain proposals from selected team sources.",
    outcome: "Give each team a useful brain without exposing unrelated departments.",
    tier: "team",
    status: "review",
    permissions: ["brain:read", "brain:write", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_candidate_memory_extractor",
    name: "Candidate memory extractor",
    slug: "candidate-memory-extractor",
    description: "Extracts candidate memory atoms from sampled and approved artifacts.",
    outcome: "Convert connected work into reviewable, source-backed memory.",
    tier: "department",
    status: "review",
    permissions: ["brain:read", "brain:write", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_decision_log_maintainer",
    name: "Decision log maintainer",
    slug: "decision-log-maintainer",
    description: "Maintains reviewed decision logs from meetings, issues, docs, and PRs.",
    outcome: "Keep decisions traceable without relying on manual status updates.",
    tier: "department",
    status: "review",
    permissions: ["brain:read", "brain:write", "registry:read"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  },
  {
    id: "skill_brain_health_operator",
    name: "Brain health operator",
    slug: "brain-health-operator",
    description: "Runs stale memory, conflict, connector, registry, and reviewer health loops.",
    outcome: "Show what is stale, risky, blocked, or ready for review.",
    tier: "company-main",
    status: "review",
    permissions: ["brain:read", "registry:read", "audit:read", "cron:run"],
    dependencies: ["tool_brain_query"],
    version: "1.0.0"
  }
];

export function createDefaultOperatorPackages(input: { tenantId?: string; ownerId?: string; updatedAt?: string } = {}): SkillPackage[] {
  const tenantId = input.tenantId ?? "tenant_demo";
  const ownerId = input.ownerId ?? "usr_admin";
  const updatedAt = input.updatedAt ?? "2026-06-30T12:00:00.000Z";

  return defaultOperatorDefinitions.map((operator) => ({
    id: operator.id,
    tenantId,
    kind: "skill",
    name: operator.name,
    slug: operator.slug,
    description: operator.description,
    tier: operator.tier,
    ownerId,
    version: operator.version,
    status: operator.status,
    permissions: operator.permissions,
    dependencies: operator.dependencies,
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt,
    skillMarkdown: `# ${operator.name}\n\n${operator.outcome}\n\nUse only accessible company brain context, cite source-backed claims, and open proposals instead of making broad changes directly.`,
    evals: [`evals/${operator.slug}/grounding.yml`, `evals/${operator.slug}/permissions.yml`],
    examples: [`${operator.outcome}`],
    changelog: ["1.0.0: Added as a default onboarding AI operator."],
    rollbackTarget: operator.slug === "onboarding-brief" ? "1.3.0" : "0.9.0"
  }));
}

export function defaultOperatorSummary(role: Principal["role"] = "admin") {
  const packages = createDefaultOperatorPackages();
  return {
    total: packages.length,
    published: packages.filter((operator) => operator.status === "published").length,
    reviewGated: packages.filter((operator) => operator.status === "review").length,
    visible: packages.filter((operator) => role === "admin" || operator.status === "published").map((operator) => operator.slug)
  };
}
