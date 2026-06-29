import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brainTiers, type BrainTier } from "./types";

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
  action: "tenant.bootstrap" | "admin.bootstrap";
  actorId: string;
  targetId: string;
  metadata: Record<string, string | boolean | string[]>;
  createdAt: string;
};

export type SetupState = {
  isComplete: boolean;
  tenant: SetupTenant | null;
  admin: SetupAdmin | null;
  settings: SetupSettings | null;
  brainTiers: BrainTier[];
  auditEvents: SetupAuditEvent[];
};

export type BootstrapTenantInput = {
  tenantName: string;
  adminName: string;
  adminEmail: string;
  encryptionKey: string;
  composioProjectId: string;
  composioApiKeyConfigured: boolean;
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
  auditEvents: []
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
    }
  ];

  const state: SetupState = {
    isComplete: true,
    tenant,
    admin,
    settings,
    brainTiers: [...brainTiers],
    auditEvents
  };

  writeSetupState(path, state);
  return state;
}

