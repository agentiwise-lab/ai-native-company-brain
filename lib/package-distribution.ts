import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canDiscoverRegistryItem } from "./policy";
import { scoreRegistryItem } from "./quality";
import { changesets as seedChangesets, principals as seedPrincipals, registry as seedRegistry } from "./seed";
import { createAgentExportService, type AgentExportBundle, type AgentExportStore } from "./agent-exports";
import type { AgentTarget, BrainEvent, Changeset, Principal, RegistryItem } from "./types";

export type PackageInstallOption = {
  target: AgentTarget;
  installUrl: string;
  downloadUrl?: string;
  installSnippet: string;
};

export type PackageCatalogEntry = {
  packageId: string;
  slug: string;
  name: string;
  kind: RegistryItem["kind"];
  version: string;
  status: RegistryItem["status"];
  qualityScore: number;
  changelog: string[];
  compatibleAgents: AgentTarget[];
  rollbackTarget: string;
  installOptions: PackageInstallOption[];
};

export type PackageInstallPin = {
  id: string;
  principalId: string;
  packageId: string;
  slug: string;
  version: string;
  target: AgentTarget;
  bundleId: string;
  installSnippet: string;
  createdAt: string;
};

export type PackageRollbackRecord = {
  id: string;
  packageId: string;
  slug: string;
  fromVersion: string;
  targetVersion: string;
  restoredPackageId: string;
  dependentPackages: Array<{ id: string; slug: string; version: string; kind: RegistryItem["kind"] }>;
  changeset: Changeset;
  auditEvent: BrainEvent;
  createdAt: string;
};

export type PackageDistributionState = {
  pins: PackageInstallPin[];
  rollbacks: PackageRollbackRecord[];
  auditEvents: BrainEvent[];
};

export type PackageDistributionStore = {
  read(): Promise<PackageDistributionState | null>;
  write(state: PackageDistributionState): Promise<void>;
};

type ServiceOptions = {
  store?: PackageDistributionStore;
  exportStore?: AgentExportStore;
  registryItems?: RegistryItem[];
  changesets?: Changeset[];
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type CatalogInput = {
  principal: Principal;
};

type InstallInput = {
  principal: Principal;
  packageId: string;
  version?: string;
  target: AgentTarget;
};

type RollbackInput = {
  principal: Principal;
  packageId: string;
  fromVersion: string;
  targetVersion: string;
};

function defaultStatePath() {
  return process.env.PACKAGE_DISTRIBUTION_STATE_PATH ?? join(process.cwd(), "data", "package-distribution-state.json");
}

function createFileStore(path = defaultStatePath()): PackageDistributionStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as PackageDistributionState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): PackageDistributionState {
  return {
    pins: [],
    rollbacks: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rollbackTarget(item: RegistryItem) {
  return "rollbackTarget" in item && item.rollbackTarget ? item.rollbackTarget : "previous";
}

function changelogFor(item: RegistryItem) {
  if (item.kind === "skill") {
    return item.changelog;
  }
  return [`${item.version}: Published ${item.kind} package.`];
}

function latestFirst(items: RegistryItem[]) {
  return [...items].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }) || b.updatedAt.localeCompare(a.updatedAt));
}

function findPackage(registryItems: RegistryItem[], packageId: string, version?: string) {
  const candidates = registryItems.filter((item) => (item.id === packageId || item.slug === packageId) && item.status === "published");
  const versioned = version ? candidates.filter((item) => item.version === version) : candidates;
  return latestFirst(versioned)[0];
}

function findPrincipal(principal?: Principal | string) {
  if (typeof principal === "object" && principal) {
    return principal;
  }
  const byId = principal ? seedPrincipals.find((candidate) => candidate.id === principal) : undefined;
  return byId ?? seedPrincipals[0];
}

function canListPackage(principal: Principal, item: RegistryItem) {
  const discovery = canDiscoverRegistryItem(principal, item);
  const scopeAllowed =
    ["admin", "reviewer", "operator"].includes(principal.role) ||
    principal.scopes.some((scope) => ["registry:read", "registry:install", "registry:publish"].includes(scope));
  return discovery.allowed && scopeAllowed;
}

function assertInstallAllowed(principal: Principal, item: RegistryItem) {
  if (!canListPackage(principal, item)) {
    throw new Error(`Principal ${principal.id} is not authorized to install ${item.slug}.`);
  }
  if (!["admin", "reviewer", "operator"].includes(principal.role) && !principal.scopes.includes("registry:install")) {
    throw new Error(`Principal ${principal.id} lacks registry:install scope.`);
  }
}

function assertRollbackAllowed(principal: Principal, item: RegistryItem) {
  if (!canListPackage(principal, item)) {
    throw new Error(`Principal ${principal.id} cannot access ${item.slug}.`);
  }
  if (!["admin", "reviewer", "operator"].includes(principal.role) && !principal.scopes.includes("registry:publish")) {
    throw new Error(`Principal ${principal.id} lacks rollback permission.`);
  }
}

function installSnippet(target: AgentTarget, item: RegistryItem, downloadUrl?: string) {
  if (target === "codex") {
    return `codex plugin install ${downloadUrl ?? `/api/v1/registry/distribution/install?package=${item.slug}&target=codex`} --pin ${item.version}`;
  }
  if (target === "claude-code") {
    return `claude plugin install ${downloadUrl ?? `/api/v1/registry/distribution/install?package=${item.slug}&target=claude-code`} --version ${item.version}`;
  }
  if (target === "opencode") {
    return `opencode plugin add ${downloadUrl ?? `/api/v1/registry/distribution/install?package=${item.slug}&target=opencode`} --pin ${item.version}`;
  }
  return `curl -L ${downloadUrl ?? `/api/v1/registry/distribution/install?package=${item.slug}&target=generic-mcp`} -o ${target}-${item.slug}-${item.version}.json`;
}

function catalogEntry(item: RegistryItem, changesets: Changeset[]): PackageCatalogEntry {
  return {
    packageId: item.id,
    slug: item.slug,
    name: item.name,
    kind: item.kind,
    version: item.version,
    status: item.status,
    qualityScore: scoreRegistryItem(item, changesets),
    changelog: changelogFor(item),
    compatibleAgents: item.adapterTargets,
    rollbackTarget: rollbackTarget(item),
    installOptions: item.adapterTargets.map((target) => ({
      target,
      installUrl: "/api/v1/registry/distribution/install",
      installSnippet: installSnippet(target, item)
    }))
  };
}

function dependentPackages(item: RegistryItem, registryItems: RegistryItem[]) {
  const ids = new Set([item.id, item.slug]);
  return registryItems
    .filter((candidate) => candidate.id !== item.id && candidate.status === "published")
    .filter(
      (candidate) =>
        candidate.dependencies.some((dependency) => ids.has(dependency)) ||
        candidate.requiredTools.some((requiredTool) => ids.has(requiredTool))
    )
    .map((candidate) => ({
      id: candidate.id,
      slug: candidate.slug,
      version: candidate.version,
      kind: candidate.kind
    }));
}

export function createPackageDistributionService(options: ServiceOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const changesets = options.changesets ?? seedChangesets;
  const exportService = createAgentExportService({ store: options.exportStore, registryItems, now: options.now, id: options.id });
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: PackageDistributionState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async listCatalog(input: CatalogInput) {
      const packages = latestFirst(registryItems)
        .filter((item) => item.status === "published")
        .filter((item) => canListPackage(input.principal, item))
        .map((item) => catalogEntry(item, changesets));
      return { packages };
    },

    async installPackage(input: InstallInput) {
      const item = findPackage(registryItems, input.packageId, input.version);
      if (!item) {
        throw new Error(`Published package ${input.packageId}${input.version ? `@${input.version}` : ""} was not found.`);
      }
      assertInstallAllowed(input.principal, item);
      if (!item.adapterTargets.includes(input.target)) {
        throw new Error(`${item.slug}@${item.version} does not support ${input.target}.`);
      }

      const generated = await exportService.generatePackageExports({ packageId: item.id, targets: [input.target] });
      const bundle = generated.bundles[0] as AgentExportBundle;
      const snippet = installSnippet(input.target, item, bundle.downloadUrl);
      const pin: PackageInstallPin = {
        id: id("package_pin"),
        principalId: input.principal.id,
        packageId: item.id,
        slug: item.slug,
        version: item.version,
        target: input.target,
        bundleId: bundle.id,
        installSnippet: snippet,
        createdAt: now()
      };
      const state = await load();
      state.pins = [
        pin,
        ...state.pins.filter(
          (candidate) => !(candidate.principalId === pin.principalId && candidate.slug === pin.slug && candidate.target === pin.target)
        )
      ];
      await save(state);
      return {
        package: item,
        bundle,
        pin,
        installSnippet: snippet
      };
    },

    async rollbackPackage(input: RollbackInput) {
      const current = findPackage(registryItems, input.packageId, input.fromVersion);
      if (!current) {
        throw new Error(`Published package ${input.packageId}@${input.fromVersion} was not found.`);
      }
      assertRollbackAllowed(input.principal, current);
      const restored = findPackage(registryItems, current.slug, input.targetVersion);
      if (!restored) {
        throw new Error(`Rollback target ${current.slug}@${input.targetVersion} was not found.`);
      }

      const timestamp = now();
      const dependents = dependentPackages(current, registryItems);
      const changeset: Changeset = {
        id: id("cs_rollback"),
        tenantId: current.tenantId,
        title: `Rollback ${current.slug} from ${current.version} to ${restored.version}`,
        targetType: current.kind,
        targetId: current.id,
        tier: current.tier,
        authorId: input.principal.id,
        ownerId: current.ownerId,
        reviewers: [input.principal.id],
        status: "approved",
        summary: `Restores ${current.slug} to ${restored.version} and flags ${dependents.length} dependent package(s).`,
        checks: [
          {
            id: "rollback_target",
            label: "Rollback target",
            status: "passed",
            detail: `${restored.slug}@${restored.version} is published.`
          },
          {
            id: "dependent_impact",
            label: "Dependent impact",
            status: dependents.length > 0 ? "warning" : "passed",
            detail: dependents.length > 0 ? dependents.map((item) => `${item.slug}@${item.version}`).join(", ") : "No dependents found."
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const auditEvent: BrainEvent = {
        id: id("evt_rollback"),
        tenantId,
        actorId: input.principal.id,
        action: "rollback",
        targetId: current.id,
        targetType: current.kind,
        policyDecision: "allow",
        metadata: {
          fromVersion: current.version,
          targetVersion: restored.version,
          restoredPackageId: restored.id,
          dependentPackages: dependents
        },
        createdAt: timestamp
      };

      const generated = await exportService.generatePackageExports({ packageId: restored.id, targets: restored.adapterTargets });
      const rollback: PackageRollbackRecord = {
        id: id("package_rollback"),
        packageId: current.id,
        slug: current.slug,
        fromVersion: current.version,
        targetVersion: restored.version,
        restoredPackageId: restored.id,
        dependentPackages: dependents,
        changeset,
        auditEvent,
        createdAt: timestamp
      };
      const state = await load();
      state.rollbacks = [rollback, ...state.rollbacks];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return {
        restoredPackage: restored,
        bundles: generated.bundles,
        rollback
      };
    }
  };
}

export function resolveDistributionPrincipal(principal?: Principal | string) {
  return findPrincipal(principal);
}

export const packageDistributionService = createPackageDistributionService();
