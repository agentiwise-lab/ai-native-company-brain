import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canDiscoverRegistryItem } from "./policy";
import { principals as seedPrincipals, registry as seedRegistry } from "./seed";
import type { BrainEvent, BrainTier, Changeset, Principal, RegistryItem, ReviewCheck, SkillPackage } from "./types";

export type MarketplaceSource = "private" | "public" | "partner";
export type MarketplaceSecurityStatus = "passed" | "warning" | "blocked";
export type MarketplaceSignatureStatus = "valid" | "missing" | "invalid";

export type MarketplaceTrust = {
  signatureStatus: MarketplaceSignatureStatus;
  provenance: {
    publisher: string;
    sourceUrl: string;
    digest: string;
    signedAt?: string;
  };
  security: {
    status: MarketplaceSecurityStatus;
    scanId: string;
    findings: string[];
  };
  evalResults: {
    status: "passed" | "warning" | "failed";
    passRate: number;
    suites: string[];
  };
};

export type MarketplacePackage = {
  source: Exclude<MarketplaceSource, "private">;
  owner: string;
  installCount: number;
  manifest: RegistryItem;
  trust: MarketplaceTrust;
};

export type MarketplaceListing = {
  packageId: string;
  source: MarketplaceSource;
  owner: string;
  kind: RegistryItem["kind"];
  slug: string;
  name: string;
  description: string;
  version: string;
  tier: BrainTier;
  compatibleAgents: RegistryItem["adapterTargets"];
  evalResults: MarketplaceTrust["evalResults"];
  securityStatus: MarketplaceSecurityStatus;
  installCount: number;
  changelog: string[];
  permissionSummary: string[];
  dependencySummary: {
    required: string[];
    resolved: string[];
    missing: string[];
  };
  trust: MarketplaceTrust;
};

export type MarketplaceReviewRecord = {
  id: string;
  packageId: string;
  packageSlug: string;
  source: MarketplaceSource;
  reviewerId: string;
  decision: "approved-for-install" | "blocked";
  evidence: {
    signatureStatus: MarketplaceSignatureStatus;
    provenance: MarketplaceTrust["provenance"];
    security: MarketplaceTrust["security"];
    dependencies: MarketplaceListing["dependencySummary"];
    permissions: string[];
    compatibility: RegistryItem["adapterTargets"];
    evalResults: MarketplaceTrust["evalResults"];
  };
  createdAt: string;
};

export type MarketplaceInstallRecord = {
  id: string;
  packageId: string;
  packageSlug: string;
  source: MarketplaceSource;
  version: string;
  principalId: string;
  targetTier: BrainTier;
  changesetId: string;
  dependencyChangesetIds: string[];
  published: false;
  createdAt: string;
};

export type MarketplaceRollbackRecord = {
  id: string;
  installId: string;
  packageId: string;
  packageSlug: string;
  reason: string;
  changeset: Changeset;
  auditEvent: BrainEvent;
  createdAt: string;
};

export type MarketplaceState = {
  installs: MarketplaceInstallRecord[];
  reviews: MarketplaceReviewRecord[];
  rollbacks: MarketplaceRollbackRecord[];
  auditEvents: BrainEvent[];
};

export type MarketplaceStore = {
  read(): Promise<MarketplaceState | null>;
  write(state: MarketplaceState): Promise<void>;
};

type ServiceOptions = {
  store?: MarketplaceStore;
  registryItems?: RegistryItem[];
  publicPackages?: MarketplacePackage[];
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type ListInput = {
  principal: Principal;
  source?: MarketplaceSource;
};

type ReviewInput = {
  principal: Principal;
  packageId: string;
};

type InstallInput = {
  principal: Principal;
  packageId: string;
  targetTier: BrainTier;
  includeDependencies?: boolean;
};

type RollbackInput = {
  principal: Principal;
  installId: string;
  reason: string;
};

type MarketplaceCandidate = {
  source: MarketplaceSource;
  owner: string;
  installCount: number;
  manifest: RegistryItem;
  trust: MarketplaceTrust;
};

function defaultStatePath() {
  return process.env.MARKETPLACE_STATE_PATH ?? join(process.cwd(), "data", "marketplace-state.json");
}

function createFileStore(path = defaultStatePath()): MarketplaceStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as MarketplaceState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): MarketplaceState {
  return {
    installs: [],
    reviews: [],
    rollbacks: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTrust(item: RegistryItem, source: MarketplaceSource): MarketplaceTrust {
  const hasEvalCoverage = item.kind !== "skill" || item.evals.length > 0;
  return {
    signatureStatus: source === "private" ? "valid" : "missing",
    provenance: {
      publisher: item.ownerId,
      sourceUrl: source === "private" ? `urn:private-registry:${item.slug}` : `https://marketplace.example.com/${item.slug}`,
      digest: `sha256:${item.id}:${item.version}`
    },
    security: {
      status: item.status === "blocked" ? "blocked" : "passed",
      scanId: `scan_${item.id}`,
      findings: []
    },
    evalResults: {
      status: hasEvalCoverage ? "passed" : "warning",
      passRate: hasEvalCoverage ? 0.92 : 0.74,
      suites: item.kind === "skill" ? item.evals : ["manifest", "permissions", "adapter"]
    }
  };
}

function publicSalesFollowup(): MarketplacePackage {
  const manifest: SkillPackage = {
    id: "skill_public_sales_followup",
    tenantId: "marketplace_public",
    kind: "skill",
    name: "Public sales follow-up",
    slug: "public-sales-followup",
    description: "Community skill for drafting CRM-backed sales follow-up with governed citations.",
    tier: "team",
    ownerId: "community_ai_native",
    version: "0.6.0",
    status: "published",
    permissions: ["brain:read", "registry:read", "crm:read"],
    dependencies: ["atom_001"],
    requiredTools: ["tool_brain_query"],
    adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
    updatedAt: "2026-06-30T08:00:00.000Z",
    skillMarkdown: "# Public sales follow-up\n\nDraft follow-ups with governed CRM and company brain context.",
    evals: ["evals/public-sales-followup/grounding.yml", "evals/public-sales-followup/permission.yml"],
    examples: ["Draft a follow-up for an enterprise opportunity using cited CRM context."],
    changelog: ["0.6.0: Added OpenCode permission examples.", "0.5.0: Added CRM citation guardrails."],
    rollbackTarget: "0.5.0"
  };

  return {
    source: "public",
    owner: "AI Native Community",
    installCount: 842,
    manifest,
    trust: {
      signatureStatus: "valid",
      provenance: {
        publisher: "AI Native Community",
        sourceUrl: "https://marketplace.example.com/public-sales-followup",
        digest: "sha256:public-sales-followup-0.6.0",
        signedAt: "2026-06-30T08:00:00.000Z"
      },
      security: {
        status: "passed",
        scanId: "scan_public_sales_followup",
        findings: []
      },
      evalResults: {
        status: "passed",
        passRate: 0.94,
        suites: ["grounding", "acl", "permission", "adapter"]
      }
    }
  };
}

function defaultPublicPackages() {
  return [publicSalesFollowup()];
}

function changelogFor(item: RegistryItem) {
  if (item.kind === "skill") {
    return item.changelog;
  }
  return [`${item.version}: Published ${item.kind} package.`];
}

function isSamePackage(item: RegistryItem, packageId: string) {
  return item.id === packageId || item.slug === packageId;
}

function findPrincipal(principal?: Principal | string) {
  if (typeof principal === "object" && principal) {
    return principal;
  }
  const byId = principal ? seedPrincipals.find((candidate) => candidate.id === principal) : undefined;
  return byId ?? seedPrincipals[0];
}

function assertCanUseMarketplace(principal: Principal, scope = "registry:install") {
  if (["admin", "reviewer", "operator"].includes(principal.role)) {
    return;
  }
  if (principal.scopes.includes(scope)) {
    return;
  }
  throw new Error(`Principal ${principal.id} lacks ${scope} marketplace permission.`);
}

function privateCandidates(registryItems: RegistryItem[], principal: Principal): MarketplaceCandidate[] {
  return registryItems
    .filter((item) => item.status === "published")
    .filter((item) => canDiscoverRegistryItem(principal, item).allowed)
    .map((item) => ({
      source: "private" as const,
      owner: item.ownerId,
      installCount: 0,
      manifest: item,
      trust: defaultTrust(item, "private")
    }));
}

function allCandidates(registryItems: RegistryItem[], publicPackages: MarketplacePackage[], principal: Principal) {
  return [
    ...privateCandidates(registryItems, principal),
    ...publicPackages.map((item) => ({
      source: item.source,
      owner: item.owner,
      installCount: item.installCount,
      manifest: item.manifest,
      trust: item.trust
    }))
  ];
}

function resolveDependencyNames(item: RegistryItem, registryItems: RegistryItem[], publicPackages: MarketplacePackage[]) {
  const localIds = new Set(registryItems.flatMap((entry) => [entry.id, entry.slug]));
  const publicIds = new Set(publicPackages.flatMap((entry) => [entry.manifest.id, entry.manifest.slug]));
  const required = [...item.dependencies, ...item.requiredTools];
  const resolved = required.filter((dependency) => dependency.startsWith("atom_") || localIds.has(dependency));
  const missing = required.filter((dependency) => !dependency.startsWith("atom_") && !localIds.has(dependency) && publicIds.has(dependency));
  const unresolved = required.filter((dependency) => !dependency.startsWith("atom_") && !localIds.has(dependency) && !publicIds.has(dependency));
  return {
    required,
    resolved,
    missing: [...missing, ...unresolved]
  };
}

function listingFor(candidate: MarketplaceCandidate, registryItems: RegistryItem[], publicPackages: MarketplacePackage[], state: MarketplaceState): MarketplaceListing {
  const item = candidate.manifest;
  const installs = state.installs.filter((install) => install.packageSlug === item.slug).length;
  return {
    packageId: item.id,
    source: candidate.source,
    owner: candidate.owner,
    kind: item.kind,
    slug: item.slug,
    name: item.name,
    description: item.description,
    version: item.version,
    tier: item.tier,
    compatibleAgents: item.adapterTargets,
    evalResults: candidate.trust.evalResults,
    securityStatus: candidate.trust.security.status,
    installCount: candidate.installCount + installs,
    changelog: changelogFor(item),
    permissionSummary: item.permissions,
    dependencySummary: resolveDependencyNames(item, registryItems, publicPackages),
    trust: candidate.trust
  };
}

function safetyErrors(candidate: MarketplaceCandidate) {
  const item = candidate.manifest;
  const errors: string[] = [];
  if (candidate.trust.security.status === "blocked") {
    errors.push(`Security scan ${candidate.trust.security.scanId} blocked this package.`);
  }
  if (candidate.trust.signatureStatus === "invalid") {
    errors.push("Package signature is invalid.");
  }
  const riskyPermissions = item.permissions.filter(
    (permission) => permission.startsWith("secrets:") || permission.startsWith("shell:") || permission.endsWith(":admin")
  );
  if (riskyPermissions.length > 0) {
    errors.push(`Unsafe permissions requested: ${riskyPermissions.join(", ")}.`);
  }
  return errors;
}

function reviewChecksFor(candidate: MarketplaceCandidate, dependencies: MarketplaceListing["dependencySummary"], errors: string[]): ReviewCheck[] {
  const trust = candidate.trust;
  return [
    {
      id: "marketplace_signature",
      label: "Signature",
      status: trust.signatureStatus === "valid" ? "passed" : trust.signatureStatus === "missing" ? "warning" : "failed",
      detail: `Signature status is ${trust.signatureStatus}.`
    },
    {
      id: "marketplace_security",
      label: "Security scan",
      status: trust.security.status === "passed" ? "passed" : trust.security.status === "warning" ? "warning" : "failed",
      detail: trust.security.findings.length > 0 ? trust.security.findings.join(" ") : `Scan ${trust.security.scanId} passed.`
    },
    {
      id: "marketplace_dependencies",
      label: "Dependencies",
      status: dependencies.missing.length > 0 ? "warning" : "passed",
      detail:
        dependencies.missing.length > 0
          ? `Marketplace dependencies need local changesets: ${dependencies.missing.join(", ")}.`
          : "All dependencies are local or atom references."
    },
    {
      id: "marketplace_permissions",
      label: "Permissions",
      status: errors.some((error) => error.includes("permissions")) ? "failed" : "passed",
      detail: candidate.manifest.permissions.length > 0 ? candidate.manifest.permissions.join(", ") : "No permissions requested."
    }
  ];
}

function changesetFor(input: {
  id: string;
  item: RegistryItem;
  source: MarketplaceSource;
  trust: MarketplaceTrust;
  principal: Principal;
  targetTier: BrainTier;
  timestamp: string;
  dependencies: MarketplaceListing["dependencySummary"];
  errors: string[];
}) {
  return {
    id: input.id,
    tenantId: input.item.tenantId,
    title: `Install ${input.source} marketplace ${input.item.kind} ${input.item.slug}@${input.item.version}`,
    targetType: input.item.kind,
    targetId: input.item.id,
    tier: input.targetTier,
    authorId: input.principal.id,
    ownerId: input.item.ownerId,
    reviewers: ["usr_reviewer"],
    status: "draft",
    summary: `Local marketplace install changeset for ${input.item.name}. Package is not published until registry review merges this changeset.`,
    checks: reviewChecksFor(
      {
        source: input.source,
        owner: input.item.ownerId,
        installCount: 0,
        manifest: input.item,
        trust: input.trust
      },
      input.dependencies,
      input.errors
    ),
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  } satisfies Changeset;
}

function auditEvent(input: {
  id: string;
  tenantId: string;
  actorId: string;
  action: BrainEvent["action"];
  targetId: string;
  targetType: BrainEvent["targetType"];
  policyDecision: BrainEvent["policyDecision"];
  metadata: Record<string, unknown>;
  createdAt: string;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    targetId: input.targetId,
    targetType: input.targetType,
    policyDecision: input.policyDecision,
    metadata: input.metadata,
    createdAt: input.createdAt
  } satisfies BrainEvent;
}

export function createMarketplaceService(options: ServiceOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const publicPackages = options.publicPackages ?? defaultPublicPackages();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: MarketplaceState) {
    await store.write(state);
  }

  async function findCandidate(principal: Principal, packageId: string, state?: MarketplaceState) {
    const loaded = state ?? (await load());
    return allCandidates(registryItems, publicPackages, principal)
      .map((candidate) => ({
        candidate,
        listing: listingFor(candidate, registryItems, publicPackages, loaded)
      }))
      .find(({ candidate }) => isSamePackage(candidate.manifest, packageId));
  }

  function dependencyPackages(item: RegistryItem) {
    const localIds = new Set(registryItems.flatMap((entry) => [entry.id, entry.slug]));
    return item.dependencies
      .filter((dependency) => !dependency.startsWith("atom_") && !localIds.has(dependency))
      .map((dependency) => publicPackages.find((candidate) => isSamePackage(candidate.manifest, dependency)))
      .filter((candidate): candidate is MarketplacePackage => Boolean(candidate));
  }

  return {
    async getState() {
      return load();
    },

    async listMarketplace(input: ListInput) {
      const state = await load();
      const packages = allCandidates(registryItems, publicPackages, input.principal)
        .filter((candidate) => (input.source ? candidate.source === input.source : true))
        .map((candidate) => listingFor(candidate, registryItems, publicPackages, state))
        .sort((a, b) => b.installCount - a.installCount || a.slug.localeCompare(b.slug));
      return { packages };
    },

    async reviewPackage(input: ReviewInput) {
      assertCanUseMarketplace(input.principal, "registry:review");
      const state = await load();
      const found = await findCandidate(input.principal, input.packageId, state);
      if (!found) {
        throw new Error(`Marketplace package ${input.packageId} was not found.`);
      }
      const errors = safetyErrors(found.candidate);
      const timestamp = now();
      const review: MarketplaceReviewRecord = {
        id: id("marketplace_review"),
        packageId: found.candidate.manifest.id,
        packageSlug: found.candidate.manifest.slug,
        source: found.candidate.source,
        reviewerId: input.principal.id,
        decision: errors.length > 0 ? "blocked" : "approved-for-install",
        evidence: {
          signatureStatus: found.candidate.trust.signatureStatus,
          provenance: found.candidate.trust.provenance,
          security: found.candidate.trust.security,
          dependencies: found.listing.dependencySummary,
          permissions: found.candidate.manifest.permissions,
          compatibility: found.candidate.manifest.adapterTargets,
          evalResults: found.candidate.trust.evalResults
        },
        createdAt: timestamp
      };
      const event = auditEvent({
        id: id("evt_marketplace_review"),
        tenantId,
        actorId: input.principal.id,
        action: "marketplace.review",
        targetId: found.candidate.manifest.id,
        targetType: found.candidate.manifest.kind,
        policyDecision: errors.length > 0 ? "deny" : "allow",
        metadata: { packageSlug: found.candidate.manifest.slug, decision: review.decision, errors },
        createdAt: timestamp
      });
      state.reviews = [review, ...state.reviews];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { review, auditEvent: event };
    },

    async installPackage(input: InstallInput) {
      assertCanUseMarketplace(input.principal, "registry:install");
      const state = await load();
      const found = await findCandidate(input.principal, input.packageId, state);
      if (!found) {
        throw new Error(`Marketplace package ${input.packageId} was not found.`);
      }

      const errors = safetyErrors(found.candidate);
      if (errors.length > 0) {
        const event = auditEvent({
          id: id("evt_marketplace_block"),
          tenantId,
          actorId: input.principal.id,
          action: "marketplace.install.block",
          targetId: found.candidate.manifest.id,
          targetType: found.candidate.manifest.kind,
          policyDecision: "deny",
          metadata: {
            packageSlug: found.candidate.manifest.slug,
            errors,
            securityStatus: found.candidate.trust.security.status,
            signatureStatus: found.candidate.trust.signatureStatus
          },
          createdAt: now()
        });
        state.auditEvents = [event, ...state.auditEvents];
        await save(state);
        throw new Error(`Marketplace package ${found.candidate.manifest.slug} is blocked: ${errors.join(" ")}`);
      }

      const missingDependencyPackages = dependencyPackages(found.candidate.manifest);
      const marketplaceDependencyIds = new Set(missingDependencyPackages.flatMap((item) => [item.manifest.id, item.manifest.slug]));
      const unresolvedDependencies = found.listing.dependencySummary.missing.filter((dependency) => !marketplaceDependencyIds.has(dependency));
      if (unresolvedDependencies.length > 0) {
        const event = auditEvent({
          id: id("evt_marketplace_block"),
          tenantId,
          actorId: input.principal.id,
          action: "marketplace.install.block",
          targetId: found.candidate.manifest.id,
          targetType: found.candidate.manifest.kind,
          policyDecision: "deny",
          metadata: {
            packageSlug: found.candidate.manifest.slug,
            errors: [`Unresolved dependencies: ${unresolvedDependencies.join(", ")}.`]
          },
          createdAt: now()
        });
        state.auditEvents = [event, ...state.auditEvents];
        await save(state);
        throw new Error(`Unresolved marketplace dependencies: ${unresolvedDependencies.join(", ")}.`);
      }
      if (missingDependencyPackages.length > 0 && !input.includeDependencies) {
        throw new Error(`Missing marketplace dependencies: ${missingDependencyPackages.map((item) => item.manifest.slug).join(", ")}.`);
      }

      const timestamp = now();
      const dependencyChangesets = missingDependencyPackages.map((dependency) => {
        const dependencySummary = resolveDependencyNames(dependency.manifest, registryItems, publicPackages);
        return changesetFor({
          id: id("cs_marketplace_dependency"),
          item: dependency.manifest,
          source: dependency.source,
          trust: dependency.trust,
          principal: input.principal,
          targetTier: input.targetTier,
          timestamp,
          dependencies: dependencySummary,
          errors: []
        });
      });
      const changeset = changesetFor({
        id: id("cs_marketplace_install"),
        item: found.candidate.manifest,
        source: found.candidate.source,
        trust: found.candidate.trust,
        principal: input.principal,
        targetTier: input.targetTier,
        timestamp,
        dependencies: found.listing.dependencySummary,
        errors: []
      });
      const install: MarketplaceInstallRecord = {
        id: id("marketplace_install"),
        packageId: found.candidate.manifest.id,
        packageSlug: found.candidate.manifest.slug,
        source: found.candidate.source,
        version: found.candidate.manifest.version,
        principalId: input.principal.id,
        targetTier: input.targetTier,
        changesetId: changeset.id,
        dependencyChangesetIds: dependencyChangesets.map((item) => item.id),
        published: false,
        createdAt: timestamp
      };
      const event = auditEvent({
        id: id("evt_marketplace_install"),
        tenantId,
        actorId: input.principal.id,
        action: "marketplace.install.open",
        targetId: found.candidate.manifest.id,
        targetType: found.candidate.manifest.kind,
        policyDecision: "needs-approval",
        metadata: {
          packageSlug: found.candidate.manifest.slug,
          source: found.candidate.source,
          changesetId: changeset.id,
          dependencyChangesets: dependencyChangesets.map((item) => item.id)
        },
        createdAt: timestamp
      });
      state.installs = [install, ...state.installs];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return {
        package: found.candidate.manifest,
        listing: found.listing,
        install,
        changeset,
        dependencyChangesets,
        dependencyPlan: {
          required: found.listing.dependencySummary.required,
          resolved: found.listing.dependencySummary.resolved,
          missing: missingDependencyPackages.map((item) => item.manifest.slug),
          staged: dependencyChangesets.map((item) => {
            const dependency = missingDependencyPackages.find((candidate) => candidate.manifest.id === item.targetId);
            return dependency?.manifest.slug ?? item.targetId;
          })
        },
        auditEvent: event
      };
    },

    async exportPackage(input: { packageId: string; principal?: Principal }) {
      const principal = input.principal ?? seedPrincipals[0];
      const state = await load();
      const found = await findCandidate(principal, input.packageId, state);
      if (!found) {
        throw new Error(`Marketplace package ${input.packageId} was not found.`);
      }
      return {
        format: "registry-package/v1",
        compatibility: {
          cloud: true,
          selfHost: true
        },
        package: found.candidate.manifest,
        trust: found.candidate.trust,
        exportedAt: now()
      };
    },

    async rollbackInstall(input: RollbackInput) {
      assertCanUseMarketplace(input.principal, "registry:publish");
      const state = await load();
      const install = state.installs.find((candidate) => candidate.id === input.installId);
      if (!install) {
        throw new Error(`Marketplace install ${input.installId} was not found.`);
      }
      const found = await findCandidate(input.principal, install.packageId, state);
      if (!found) {
        throw new Error(`Installed marketplace package ${install.packageId} was not found.`);
      }
      const timestamp = now();
      const changeset: Changeset = {
        id: id("cs_marketplace_rollback"),
        tenantId,
        title: `Rollback marketplace install ${install.packageSlug}@${install.version}`,
        targetType: found.candidate.manifest.kind,
        targetId: found.candidate.manifest.id,
        tier: install.targetTier,
        authorId: input.principal.id,
        ownerId: found.candidate.manifest.ownerId,
        reviewers: [input.principal.id],
        status: "approved",
        summary: `Rollback marketplace install ${install.id}: ${input.reason}`,
        checks: [
          {
            id: "marketplace_install_found",
            label: "Install record",
            status: "passed",
            detail: `Install ${install.id} opened changeset ${install.changesetId}.`
          },
          {
            id: "marketplace_not_published",
            label: "Publication guard",
            status: install.published ? "warning" : "passed",
            detail: install.published ? "Package was published after install; reviewer should confirm registry state." : "Install remained review-gated."
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const event = auditEvent({
        id: id("evt_marketplace_rollback"),
        tenantId,
        actorId: input.principal.id,
        action: "marketplace.install.rollback",
        targetId: found.candidate.manifest.id,
        targetType: found.candidate.manifest.kind,
        policyDecision: "allow",
        metadata: {
          installId: install.id,
          packageSlug: install.packageSlug,
          reason: input.reason,
          changesetId: changeset.id
        },
        createdAt: timestamp
      });
      const rollback: MarketplaceRollbackRecord = {
        id: id("marketplace_rollback"),
        installId: install.id,
        packageId: install.packageId,
        packageSlug: install.packageSlug,
        reason: input.reason,
        changeset,
        auditEvent: event,
        createdAt: timestamp
      };
      state.rollbacks = [rollback, ...state.rollbacks];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { rollback };
    }
  };
}

export function resolveMarketplacePrincipal(principal?: Principal | string) {
  return findPrincipal(principal);
}

export const marketplaceService = createMarketplaceService();
