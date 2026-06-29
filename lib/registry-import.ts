import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { registry as seedRegistry } from "./seed";
import { brainTiers, registryKinds, type Changeset, type RegistryItem, type RegistryKind } from "./types";

export type RegistryImportRecord = {
  id: string;
  packageId: string;
  packageKind: RegistryKind;
  slug: string;
  version: string;
  status: "draft" | "invalid";
  errors: string[];
  createdAt: string;
  updatedAt: string;
};

export type RegistryImportPreview = {
  diffSummary: string[];
  dependencyGraph: string[];
  requiredTools: string[];
  requiredPermissions: string[];
  targetAdapters: string[];
};

export type RegistryImportState = {
  imports: RegistryImportRecord[];
  changesets: Changeset[];
};

export type RegistryImportStore = {
  read(): Promise<RegistryImportState | null>;
  write(state: RegistryImportState): Promise<void>;
};

type ServiceOptions = {
  store?: RegistryImportStore;
  registryItems?: RegistryItem[];
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type ImportOptions = {
  principalId?: string;
};

function defaultStatePath() {
  return process.env.REGISTRY_IMPORT_STATE_PATH ?? join(process.cwd(), "data", "registry-import-state.json");
}

function createFileStore(path = defaultStatePath()): RegistryImportStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as RegistryImportState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): RegistryImportState {
  return {
    imports: [],
    changesets: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function validateManifest(candidate: unknown, registryItems: RegistryItem[], existingImports: RegistryImportRecord[]) {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { item: undefined, errors: ["Manifest must be an object with kind, slug, owner, and version."] };
  }

  const kind = candidate.kind;
  if (typeof kind !== "string" || !registryKinds.includes(kind as RegistryKind)) {
    errors.push("Manifest kind must be one of tool, skill, plugin, cronjob, agent, or policy.");
  }
  const tier = candidate.tier;
  if (typeof tier !== "string" || !brainTiers.includes(tier as never)) {
    errors.push("Manifest tier must be a valid brain tier.");
  }
  for (const field of ["id", "tenantId", "name", "slug", "description", "ownerId", "version", "status", "updatedAt"]) {
    if (typeof candidate[field] !== "string" || !String(candidate[field]).trim()) {
      errors.push(`Manifest ${field} is required.`);
    }
  }
  for (const field of ["permissions", "dependencies", "requiredTools", "adapterTargets"]) {
    if (!asStringArray(candidate[field])) {
      errors.push(`Manifest ${field} must be a string array.`);
    }
  }

  if (errors.length > 0) {
    return { item: undefined, errors };
  }

  const item = candidate as unknown as RegistryItem;
  const dependencyIds = new Set(registryItems.flatMap((entry) => [entry.id, entry.slug]));
  const toolIds = new Set(registryItems.filter((entry) => entry.kind === "tool").flatMap((entry) => [entry.id, entry.slug]));
  const missingDependencies = item.dependencies.filter((dependency) => !dependencyIds.has(dependency) && !dependency.startsWith("atom_"));
  const missingTools = item.requiredTools.filter((tool) => !toolIds.has(tool));
  if (missingDependencies.length > 0) {
    errors.push(`Missing dependencies: ${missingDependencies.join(", ")}.`);
  }
  if (missingTools.length > 0) {
    errors.push(`Missing required tools: ${missingTools.join(", ")}.`);
  }
  if (
    registryItems.some((entry) => entry.kind === item.kind && entry.slug === item.slug && entry.version === item.version) ||
    existingImports.some((entry) => entry.packageKind === item.kind && entry.slug === item.slug && entry.version === item.version)
  ) {
    errors.push(`Duplicate package version for ${item.kind}:${item.slug}@${item.version}.`);
  }

  if (item.kind === "skill") {
    const skill = item;
    if (!("skillMarkdown" in skill) || typeof skill.skillMarkdown !== "string" || !skill.skillMarkdown.trim()) {
      errors.push("SkillPackage skillMarkdown is required.");
    }
    if (!("evals" in skill) || !Array.isArray(skill.evals) || skill.evals.length === 0) {
      errors.push("SkillPackage evals are required.");
    }
    if (!("examples" in skill) || !Array.isArray(skill.examples) || skill.examples.length === 0) {
      errors.push("SkillPackage examples are required.");
    }
    if (!("changelog" in skill) || !Array.isArray(skill.changelog) || skill.changelog.length === 0) {
      errors.push("SkillPackage changelog is required.");
    }
    if (!("rollbackTarget" in skill) || !skill.rollbackTarget) {
      errors.push("SkillPackage rollbackTarget is required.");
    }
  }

  return { item: errors.length > 0 ? undefined : item, errors };
}

function previewFor(item: RegistryItem, registryItems: RegistryItem[]): RegistryImportPreview {
  const existing = registryItems.find((entry) => entry.kind === item.kind && entry.slug === item.slug);
  return {
    diffSummary: existing
      ? [`Version ${existing.version} -> ${item.version}`, `Status ${existing.status} -> draft`, `Permissions ${item.permissions.join(", ") || "none"}`]
      : [`New ${item.kind} package ${item.slug}@${item.version}`, `Status ${item.status} -> draft`],
    dependencyGraph: [...item.dependencies, ...item.requiredTools],
    requiredTools: item.requiredTools,
    requiredPermissions: item.permissions,
    targetAdapters: item.adapterTargets
  };
}

function changesetFor(item: RegistryItem, importId: string, principalId: string, timestamp: string): Changeset {
  return {
    id: `${importId}:changeset`,
    tenantId: item.tenantId,
    title: `Import ${item.kind} ${item.slug}@${item.version}`,
    targetType: item.kind,
    targetId: item.id,
    tier: item.tier,
    authorId: principalId,
    ownerId: item.ownerId,
    reviewers: ["usr_reviewer"],
    status: "draft",
    summary: `Draft import for ${item.name}. Publication remains blocked until package checks and review pass.`,
    checks: [
      {
        id: "check_manifest",
        label: "Manifest validation",
        status: "passed",
        detail: "Required canonical package fields are present."
      },
      {
        id: "check_dependencies",
        label: "Dependency graph",
        status: "passed",
        detail: `${item.dependencies.length} dependencies and ${item.requiredTools.length} required tools resolved.`
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createRegistryImportService(options: ServiceOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: RegistryImportState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async importPackage(manifest: unknown, importOptions: ImportOptions = {}) {
      const state = await load();
      const validation = validateManifest(manifest, registryItems, state.imports);
      if (!validation.item) {
        throw new Error(`Invalid registry package: ${validation.errors.join(" ")}`);
      }

      const timestamp = now();
      const importRecord: RegistryImportRecord = {
        id: id("registry_import"),
        packageId: validation.item.id,
        packageKind: validation.item.kind,
        slug: validation.item.slug,
        version: validation.item.version,
        status: "draft",
        errors: [],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const changeset = changesetFor(validation.item, importRecord.id, importOptions.principalId ?? "usr_admin", timestamp);
      const preview = previewFor(validation.item, registryItems);

      state.imports = [importRecord, ...state.imports];
      state.changesets = [changeset, ...state.changesets];
      await save(state);

      return {
        importRecord,
        changeset,
        preview
      };
    }
  };
}

export const registryImportService = createRegistryImportService();
