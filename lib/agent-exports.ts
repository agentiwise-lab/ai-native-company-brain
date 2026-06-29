import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createAdapterPackageManifest,
  generateAdapterForTarget,
  validateAdapterGeneration,
  type AdapterPackageManifest,
  type GeneratedAdapter
} from "./adapters";
import { registry as seedRegistry } from "./seed";
import type { AgentTarget, RegistryItem } from "./types";

export type AgentExportBundle = {
  id: string;
  packageId: string;
  slug: string;
  version: string;
  target: AgentTarget;
  filename: string;
  installUrl: string;
  downloadUrl: string;
  manifest: AdapterPackageManifest;
  files: GeneratedAdapter["files"];
  createdAt: string;
};

export type AgentExportFailure = {
  id: string;
  packageId: string;
  slug?: string;
  target?: AgentTarget;
  errors: string[];
  createdAt: string;
};

export type AgentExportState = {
  bundles: AgentExportBundle[];
  failures: AgentExportFailure[];
};

export type AgentExportStore = {
  read(): Promise<AgentExportState | null>;
  write(state: AgentExportState): Promise<void>;
};

type ServiceOptions = {
  store?: AgentExportStore;
  registryItems?: RegistryItem[];
  now?: () => string;
  id?: (prefix: string) => string;
};

type GenerateInput = {
  packageId: string;
  targets?: AgentTarget[];
};

function defaultStatePath() {
  return process.env.AGENT_EXPORT_STATE_PATH ?? join(process.cwd(), "data", "agent-export-state.json");
}

function createFileStore(path = defaultStatePath()): AgentExportStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as AgentExportState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): AgentExportState {
  return {
    bundles: [],
    failures: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function findPackage(registryItems: RegistryItem[], packageId: string) {
  return registryItems.find((item) => item.id === packageId || item.slug === packageId);
}

function registryClosure(root: RegistryItem, registryItems: RegistryItem[]) {
  const byId = new Map(registryItems.flatMap((item) => [[item.id, item] as const, [item.slug, item] as const]));
  const byTool = new Map(
    registryItems
      .filter((item) => item.kind === "tool")
      .flatMap((item) => [[item.id, item] as const, [item.slug, item] as const])
  );
  const missingDependencies: string[] = [];
  const missingRequiredTools: string[] = [];
  const selected = new Map<string, RegistryItem>();

  function add(item: RegistryItem) {
    if (selected.has(item.id)) {
      return;
    }
    selected.set(item.id, item);

    for (const dependency of item.dependencies) {
      if (dependency.startsWith("atom_")) {
        continue;
      }
      const dependencyItem = byId.get(dependency);
      if (dependencyItem) {
        add(dependencyItem);
      } else {
        missingDependencies.push(dependency);
      }
    }

    for (const toolId of item.requiredTools) {
      const tool = byTool.get(toolId);
      if (tool) {
        add(tool);
      } else {
        missingRequiredTools.push(toolId);
      }
    }
  }

  add(root);

  const errors: string[] = [];
  if (missingDependencies.length > 0) {
    errors.push(`Missing dependencies: ${[...new Set(missingDependencies)].join(", ")}.`);
  }
  if (missingRequiredTools.length > 0) {
    errors.push(`Missing required tools: ${[...new Set(missingRequiredTools)].join(", ")}.`);
  }

  return {
    items: [...selected.values()],
    errors
  };
}

function filenameFor(target: AgentTarget, item: RegistryItem) {
  return `${target}-${item.slug}-${item.version}.json`;
}

function bundleFor(input: {
  id: string;
  item: RegistryItem;
  target: AgentTarget;
  adapter: GeneratedAdapter;
  createdAt: string;
  closure: RegistryItem[];
}): AgentExportBundle {
  const manifest = createAdapterPackageManifest(
    input.target,
    input.item,
    input.adapter.files.map((file) => file.path),
    input.closure
  );
  const bundle: AgentExportBundle = {
    id: input.id,
    packageId: input.item.id,
    slug: input.item.slug,
    version: input.item.version,
    target: input.target,
    filename: filenameFor(input.target, input.item),
    installUrl: `/api/v1/registry/exports/${input.id}/download?install=1`,
    downloadUrl: `/api/v1/registry/exports/${input.id}/download`,
    manifest,
    files: input.adapter.files,
    createdAt: input.createdAt
  };
  return bundle;
}

export function createAgentExportService(options: ServiceOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: AgentExportState) {
    await store.write(state);
  }

  async function recordFailure(packageId: string, errors: string[], slug?: string, target?: AgentTarget) {
    const state = await load();
    const failure: AgentExportFailure = {
      id: id("agent_export_failure"),
      packageId,
      slug,
      target,
      errors,
      createdAt: now()
    };
    state.failures = [failure, ...state.failures];
    await save(state);
    return failure;
  }

  return {
    async getState() {
      return load();
    },

    async getBundle(bundleId: string) {
      const state = await load();
      return state.bundles.find((bundle) => bundle.id === bundleId);
    },

    async generatePackageExports(input: GenerateInput) {
      const item = findPackage(registryItems, input.packageId);
      if (!item) {
        const errors = [`Package ${input.packageId} was not found.`];
        await recordFailure(input.packageId, errors);
        throw new Error(errors.join(" "));
      }
      if (item.status !== "published") {
        const errors = [`Package ${item.slug}@${item.version} must be published before export.`];
        await recordFailure(input.packageId, errors, item.slug);
        throw new Error(errors.join(" "));
      }

      const closure = registryClosure(item, registryItems);
      const validation = validateAdapterGeneration(item, registryItems);
      const errors = [...validation.errors, ...closure.errors];
      if (errors.length > 0) {
        await recordFailure(input.packageId, errors, item.slug);
        throw new Error(errors.join(" "));
      }

      const targets = input.targets ?? item.adapterTargets;
      const timestamp = now();
      const bundles = targets.map((target) => {
        const adapter = generateAdapterForTarget(target, closure.items, item);
        return bundleFor({
          id: id("agent_export"),
          item,
          target,
          adapter,
          createdAt: timestamp,
          closure: closure.items
        });
      });

      const state = await load();
      state.bundles = [
        ...bundles,
        ...state.bundles.filter(
          (bundle) =>
            !(
              bundle.packageId === item.id &&
              bundle.version === item.version &&
              targets.includes(bundle.target)
            )
        )
      ];
      await save(state);

      return {
        package: item,
        bundles
      };
    }
  };
}

export const agentExportService = createAgentExportService();
