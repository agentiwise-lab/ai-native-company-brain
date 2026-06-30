import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { brainTiers, type BrainEvent, type Principal } from "./types";

export type CloudPlan = "team" | "business" | "enterprise";
export type DiagnosticStatus = "passed" | "warning" | "failed";

export type CloudManagedResources = {
  databaseUrlRef: string;
  storageBucket: string;
  queueUrlRef: string;
  secretsRef: string;
  encryptionKeyRef: string;
};

export type CloudTenantAdmin = {
  id: "usr_admin";
  name: string;
  email: string;
  role: "admin";
  createdAt: string;
};

export type CloudDiagnostic = {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
};

export type CloudTenant = {
  id: string;
  slug: string;
  name: string;
  region: string;
  plan: CloudPlan;
  status: "active" | "rolled-back";
  admin: CloudTenantAdmin;
  resources: CloudManagedResources;
  isolation: {
    tenantId: string;
    databaseSchema: string;
    storagePrefix: string;
    queuePrefix: string;
    encryptionKeyRef: string;
  };
  settings: {
    apiBasePath: "/api/v1";
    mcpPath: "/api/mcp";
    registryPackageFormat: "canonical-registry-package-v1";
    dataExportFormat: "company-brain-export-v1";
  };
  composioHandoff: {
    projectId: string;
    apiKeyConfigured: boolean;
    status: "ready" | "needs-api-key";
    nextAction: string;
  };
  firstConnectedSource: {
    status: "handoff-ready" | "blocked";
    nextAction: string;
  };
  diagnostics: CloudDiagnostic[];
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CloudSecretRotation = {
  id: string;
  tenantId: string;
  secretName: "DATABASE_URL" | "REDIS_URL" | "COMPOSIO_API_KEY" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY";
  oldRef: string;
  newRef: string;
  status: "rotated" | "denied";
  rotatedBy: string;
  rotatedAt: string;
};

export type CloudPortableExport = {
  id: string;
  tenantId: string;
  requestedBy: string;
  formatVersion: "company-brain-cloud-export-v1";
  contract: CloudTenant["settings"];
  payload: {
    setupState: {
      isComplete: true;
      tenant: { id: string; name: string; createdAt: string };
      admin: CloudTenantAdmin;
      settings: { encryptionKeyConfigured: boolean; composioProjectId: string; composioApiKeyConfigured: boolean; createdAt: string };
      brainTiers: typeof brainTiers;
      auditEvents: Array<{ id: string; action: "tenant.bootstrap" | "admin.bootstrap"; actorId: string; targetId: string; metadata: Record<string, string | boolean | string[]>; createdAt: string }>;
    };
    helmValues: {
      app: { env: Record<string, string> };
      secrets: { values: Record<string, string> };
      externalPostgres: { enabled: boolean };
      externalRedis: { enabled: boolean };
      objectStorage: { bucket: string; endpoint: string };
    };
    isolation: CloudTenant["isolation"];
    composioHandoff: CloudTenant["composioHandoff"];
  };
  createdAt: string;
};

export type CloudControlState = {
  tenants: CloudTenant[];
  secretRotations: CloudSecretRotation[];
  exports: CloudPortableExport[];
  auditEvents: BrainEvent[];
};

export type CloudControlStore = {
  read(): Promise<CloudControlState | null>;
  write(state: CloudControlState): Promise<void>;
};

export type CloudResourceProvisioner = {
  provision(input: { tenantId: string; region: string; plan: CloudPlan }): Promise<CloudManagedResources>;
  rollback(input: { tenantId: string; reason: string }): Promise<{ rolledBack: boolean }>;
};

type ProvisionTenantInput = {
  principal: Principal;
  tenantName: string;
  adminName: string;
  adminEmail: string;
  region: string;
  plan: CloudPlan;
  composioProjectId: string;
  composioApiKeyConfigured: boolean;
};

type TenantAccessInput = {
  principal: Principal;
  tenantId: string;
};

type RotateSecretInput = TenantAccessInput & {
  secretName: CloudSecretRotation["secretName"];
};

type ExportInput = TenantAccessInput;

type Options = {
  store?: CloudControlStore;
  provisioner?: CloudResourceProvisioner;
  now?: () => string;
  id?: (prefix: string) => string;
  platformTenantId?: string;
};

function defaultStatePath() {
  return process.env.CLOUD_CONTROL_STATE_PATH ?? join(process.cwd(), "data", "cloud-control-plane-state.json");
}

function createFileStore(path = defaultStatePath()): CloudControlStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as CloudControlState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): CloudControlState {
  return {
    tenants: [],
    secretRotations: [],
    exports: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

function tenantIdFromName(name: string) {
  return `tenant_${slugFromName(name)}`;
}

function createDefaultResources(tenantId: string): CloudManagedResources {
  return {
    databaseUrlRef: `secret://${tenantId}/DATABASE_URL`,
    storageBucket: `${tenantId}-objects`,
    queueUrlRef: `secret://${tenantId}/REDIS_URL`,
    secretsRef: `secret://${tenantId}/app`,
    encryptionKeyRef: `kms://${tenantId}/primary`
  };
}

function createDefaultProvisioner(): CloudResourceProvisioner {
  return {
    async provision(input) {
      return createDefaultResources(input.tenantId);
    },
    async rollback() {
      return { rolledBack: true };
    }
  };
}

function validateProvisionInput(input: ProvisionTenantInput) {
  if (!input.tenantName.trim()) {
    throw new Error("Tenant name is required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.adminEmail.trim())) {
    throw new Error("A valid admin email is required.");
  }
  if (!input.composioProjectId.trim()) {
    throw new Error("Composio project id is required.");
  }
}

function baseSettings(): CloudTenant["settings"] {
  return {
    apiBasePath: "/api/v1",
    mcpPath: "/api/mcp",
    registryPackageFormat: "canonical-registry-package-v1",
    dataExportFormat: "company-brain-export-v1"
  };
}

function diagnosticsFor(tenantId: string, resources: CloudManagedResources, composioApiKeyConfigured: boolean): CloudDiagnostic[] {
  return [
    { id: "database", label: "Managed database", status: resources.databaseUrlRef ? "passed" : "failed", detail: resources.databaseUrlRef },
    { id: "storage", label: "Managed object storage", status: resources.storageBucket ? "passed" : "failed", detail: resources.storageBucket },
    { id: "queue", label: "Managed queue", status: resources.queueUrlRef ? "passed" : "failed", detail: resources.queueUrlRef },
    { id: "secrets", label: "Tenant secrets", status: resources.secretsRef ? "passed" : "failed", detail: resources.secretsRef },
    { id: "encryption", label: "Encryption boundary", status: resources.encryptionKeyRef.includes(tenantId) ? "passed" : "failed", detail: resources.encryptionKeyRef },
    { id: "composio", label: "Composio handoff", status: composioApiKeyConfigured ? "passed" : "warning", detail: composioApiKeyConfigured ? "API key configured." : "API key handoff required." }
  ];
}

function resourceRefFor(resources: CloudManagedResources, secretName: CloudSecretRotation["secretName"]) {
  if (secretName === "DATABASE_URL") {
    return resources.databaseUrlRef;
  }
  if (secretName === "REDIS_URL") {
    return resources.queueUrlRef;
  }
  return `${resources.secretsRef}/${secretName}`;
}

function setResourceRef(resources: CloudManagedResources, secretName: CloudSecretRotation["secretName"], ref: string) {
  if (secretName === "DATABASE_URL") {
    resources.databaseUrlRef = ref;
  } else if (secretName === "REDIS_URL") {
    resources.queueUrlRef = ref;
  } else {
    resources.secretsRef = ref.replace(`/${secretName}`, "");
  }
}

export function createCloudControlPlane(options: Options = {}) {
  const store = options.store ?? createFileStore();
  const provisioner = options.provisioner ?? createDefaultProvisioner();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const platformTenantId = options.platformTenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: CloudControlState) {
    await store.write(state);
  }

  function audit(input: {
    actorId: string;
    action: BrainEvent["action"];
    targetId: string;
    targetType: BrainEvent["targetType"];
    policyDecision: BrainEvent["policyDecision"];
    metadata: Record<string, unknown>;
    createdAt: string;
  }): BrainEvent {
    return {
      id: id("evt_cloud"),
      tenantId: platformTenantId,
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      targetType: input.targetType,
      policyDecision: input.policyDecision,
      metadata: input.metadata,
      createdAt: input.createdAt
    };
  }

  function buildTenant(input: ProvisionTenantInput, resources: CloudManagedResources, timestamp: string, status: CloudTenant["status"], failureReason?: string): CloudTenant {
    const slug = slugFromName(input.tenantName);
    const tenantId = `tenant_${slug}`;
    const composioReady = Boolean(input.composioApiKeyConfigured);
    return {
      id: tenantId,
      slug,
      name: input.tenantName.trim(),
      region: input.region,
      plan: input.plan,
      status,
      admin: {
        id: "usr_admin",
        name: input.adminName.trim(),
        email: input.adminEmail.trim().toLowerCase(),
        role: "admin",
        createdAt: timestamp
      },
      resources,
      isolation: {
        tenantId,
        databaseSchema: tenantId,
        storagePrefix: `tenants/${tenantId}/`,
        queuePrefix: `${tenantId}:`,
        encryptionKeyRef: resources.encryptionKeyRef
      },
      settings: baseSettings(),
      composioHandoff: {
        projectId: input.composioProjectId.trim(),
        apiKeyConfigured: composioReady,
        status: composioReady ? "ready" : "needs-api-key",
        nextAction: composioReady ? "Create Composio auth configs and initiate the first connected account." : "Add COMPOSIO_API_KEY before initiating accounts."
      },
      firstConnectedSource: {
        status: composioReady ? "handoff-ready" : "blocked",
        nextAction: composioReady ? "Use Composio to connect the first source from the tenant setup wizard." : "Configure the Composio API key first."
      },
      diagnostics: diagnosticsFor(tenantId, resources, composioReady),
      failureReason,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function accessDecision(principal: Principal, tenant: CloudTenant | undefined) {
    if (!tenant) {
      return { allowed: false, reasons: ["Tenant was not found."] };
    }
    if (
      principal.scopes.includes("cloud:provision") ||
      principal.scopes.includes(`tenant:${tenant.id}:admin`) ||
      (principal.role === "admin" && principal.scopes.includes("audit:read")) ||
      principal.email === tenant.admin.email
    ) {
      return { allowed: true, reasons: [`Principal can administer ${tenant.id}.`] };
    }
    return { allowed: false, reasons: [`Principal ${principal.id} is not allowed to access tenant ${tenant.id}.`] };
  }

  return {
    async getState() {
      return load();
    },

    async provisionTenant(input: ProvisionTenantInput) {
      validateProvisionInput(input);
      const state = await load();
      const timestamp = now();
      const tenantId = tenantIdFromName(input.tenantName);
      const auditEvents: BrainEvent[] = [];

      try {
        const resources = await provisioner.provision({ tenantId, region: input.region, plan: input.plan });
        const tenant = buildTenant(input, resources, timestamp, "active");
        const event = audit({
          actorId: input.principal.id,
          action: "cloud.tenant.provision",
          targetId: tenant.id,
          targetType: "cloud-tenant",
          policyDecision: "allow",
          metadata: { region: tenant.region, plan: tenant.plan, resources: tenant.resources, composioProjectId: tenant.composioHandoff.projectId },
          createdAt: timestamp
        });
        auditEvents.push(event);
        state.tenants = [tenant, ...state.tenants.filter((candidate) => candidate.id !== tenant.id)];
        state.auditEvents = [...auditEvents, ...state.auditEvents];
        await save(state);
        return { tenant, auditEvents };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provisioning failed.";
        const rollback = await provisioner.rollback({ tenantId, reason: message });
        const tenant = buildTenant(input, createDefaultResources(tenantId), timestamp, "rolled-back", message);
        const event = audit({
          actorId: input.principal.id,
          action: "cloud.tenant.rollback",
          targetId: tenant.id,
          targetType: "cloud-tenant",
          policyDecision: "deny",
          metadata: { reason: message, rolledBack: rollback.rolledBack },
          createdAt: timestamp
        });
        state.tenants = [tenant, ...state.tenants.filter((candidate) => candidate.id !== tenant.id)];
        state.auditEvents = [event, ...state.auditEvents];
        await save(state);
        return { tenant, rollback, auditEvents: [event] };
      }
    },

    async assertTenantAccess(input: TenantAccessInput) {
      const state = await load();
      const timestamp = now();
      const tenant = state.tenants.find((candidate) => candidate.id === input.tenantId);
      const decision = accessDecision(input.principal, tenant);
      const event = audit({
        actorId: input.principal.id,
        action: "cloud.access.check",
        targetId: input.tenantId,
        targetType: "cloud-tenant",
        policyDecision: decision.allowed ? "allow" : "deny",
        metadata: { reasons: decision.reasons },
        createdAt: timestamp
      });
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { ...decision, tenant, auditEvent: event };
    },

    async rotateSecret(input: RotateSecretInput) {
      const state = await load();
      const timestamp = now();
      const tenant = state.tenants.find((candidate) => candidate.id === input.tenantId);
      const decision = accessDecision(input.principal, tenant);
      if (!tenant || !decision.allowed) {
        throw new Error(decision.reasons.join(" "));
      }
      const oldRef = resourceRefFor(tenant.resources, input.secretName);
      const rotationNumber = state.secretRotations.filter((rotation) => rotation.tenantId === tenant.id && rotation.secretName === input.secretName).length + 2;
      const newRef = `${oldRef.replace(/:v\d+$/, "")}:v${rotationNumber}`;
      setResourceRef(tenant.resources, input.secretName, newRef);
      tenant.updatedAt = timestamp;
      const rotation: CloudSecretRotation = {
        id: id("cloud_secret_rotation"),
        tenantId: tenant.id,
        secretName: input.secretName,
        oldRef,
        newRef,
        status: "rotated",
        rotatedBy: input.principal.id,
        rotatedAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "cloud.secret.rotate",
        targetId: rotation.id,
        targetType: "cloud-secret",
        policyDecision: "allow",
        metadata: { tenantId: tenant.id, secretName: input.secretName, oldRef, newRef },
        createdAt: timestamp
      });
      state.secretRotations = [rotation, ...state.secretRotations];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { tenant, rotation, auditEvent: event };
    },

    async exportForSelfHost(input: ExportInput) {
      const state = await load();
      const timestamp = now();
      const tenant = state.tenants.find((candidate) => candidate.id === input.tenantId);
      const decision = accessDecision(input.principal, tenant);
      if (!tenant || !decision.allowed) {
        throw new Error(decision.reasons.join(" "));
      }
      const exportRecord: CloudPortableExport = {
        id: id("cloud_export"),
        tenantId: tenant.id,
        requestedBy: input.principal.id,
        formatVersion: "company-brain-cloud-export-v1",
        contract: tenant.settings,
        payload: {
          setupState: {
            isComplete: true,
            tenant: { id: tenant.id, name: tenant.name, createdAt: tenant.createdAt },
            admin: tenant.admin,
            settings: {
              encryptionKeyConfigured: true,
              composioProjectId: tenant.composioHandoff.projectId,
              composioApiKeyConfigured: tenant.composioHandoff.apiKeyConfigured,
              createdAt: tenant.createdAt
            },
            brainTiers: [...brainTiers],
            auditEvents: [
              {
                id: `setup_evt_${tenant.id}`,
                action: "tenant.bootstrap",
                actorId: tenant.admin.id,
                targetId: tenant.id,
                metadata: { tenantName: tenant.name, brainTiers: [...brainTiers] },
                createdAt: tenant.createdAt
              },
              {
                id: `setup_evt_${tenant.admin.id}`,
                action: "admin.bootstrap",
                actorId: tenant.admin.id,
                targetId: tenant.admin.id,
                metadata: { adminEmail: tenant.admin.email, composioProjectId: tenant.composioHandoff.projectId, composioApiKeyConfigured: tenant.composioHandoff.apiKeyConfigured },
                createdAt: tenant.createdAt
              }
            ]
          },
          helmValues: {
            app: { env: { COMPANY_BRAIN_TENANT_ID: tenant.id, COMPANY_BRAIN_REPOSITORY: "postgres" } },
            secrets: {
              values: {
                DATABASE_URL: tenant.resources.databaseUrlRef,
                REDIS_URL: tenant.resources.queueUrlRef,
                COMPOSIO_API_KEY: `${tenant.resources.secretsRef}/COMPOSIO_API_KEY`,
                S3_ACCESS_KEY_ID: `${tenant.resources.secretsRef}/S3_ACCESS_KEY_ID`,
                S3_SECRET_ACCESS_KEY: `${tenant.resources.secretsRef}/S3_SECRET_ACCESS_KEY`
              }
            },
            externalPostgres: { enabled: true },
            externalRedis: { enabled: true },
            objectStorage: { bucket: tenant.resources.storageBucket, endpoint: `s3://${tenant.resources.storageBucket}` }
          },
          isolation: tenant.isolation,
          composioHandoff: tenant.composioHandoff
        },
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "cloud.export",
        targetId: exportRecord.id,
        targetType: "export",
        policyDecision: "allow",
        metadata: { tenantId: tenant.id, formatVersion: exportRecord.formatVersion, contract: exportRecord.contract },
        createdAt: timestamp
      });
      state.exports = [exportRecord, ...state.exports];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { exportRecord, auditEvent: event };
    }
  };
}

export const cloudControlPlane = createCloudControlPlane();
