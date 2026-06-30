import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createCloudControlPlane,
  type CloudControlState,
  type CloudControlStore,
  type CloudResourceProvisioner
} from "../lib/cloud-control-plane";
import type { Principal } from "../lib/types";

const cloudAdmin: Principal = {
  id: "usr_cloud_admin",
  name: "Cloud Admin",
  email: "cloud@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["cloud:provision", "audit:read"]
};

const tenantOperator: Principal = {
  id: "usr_operator",
  name: "Tenant Operator",
  email: "operator@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "company-main"],
  scopes: ["tenant:tenant_acme_ai:admin", "audit:read"]
};

const outsider: Principal = {
  id: "usr_outsider",
  name: "Outsider",
  email: "outsider@example.com",
  role: "employee",
  teams: ["sales"],
  tiers: ["individual"],
  scopes: ["brain:read"]
};

function memoryStore(initial?: Partial<CloudControlState>) {
  let state: CloudControlState | null = initial
    ? {
        tenants: [],
        secretRotations: [],
        exports: [],
        auditEvents: [],
        ...initial
      }
    : null;
  const store: CloudControlStore & { snapshot: () => CloudControlState | null } = {
    async read() {
      return state;
    },
    async write(next) {
      state = next;
    },
    snapshot() {
      return state;
    }
  };
  return store;
}

function provisioner(overrides: Partial<CloudResourceProvisioner> = {}): CloudResourceProvisioner {
  return {
    async provision(input) {
      return {
        databaseUrlRef: `secret://${input.tenantId}/DATABASE_URL`,
        storageBucket: `${input.tenantId}-objects`,
        queueUrlRef: `secret://${input.tenantId}/REDIS_URL`,
        secretsRef: `secret://${input.tenantId}/app`,
        encryptionKeyRef: `kms://${input.tenantId}/primary`
      };
    },
    async rollback() {
      return { rolledBack: true };
    },
    ...overrides
  };
}

function tenantInput() {
  return {
    principal: cloudAdmin,
    tenantName: "Acme AI",
    adminName: "Admin User",
    adminEmail: "admin@example.com",
    region: "us-east-1",
    plan: "team" as const,
    composioProjectId: "composio-acme",
    composioApiKeyConfigured: true
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("cloud control plane", () => {
  it("provisions a managed tenant with resources, Composio handoff, diagnostics, and first-source guidance", async () => {
    const service = createCloudControlPlane({
      store: memoryStore(),
      provisioner: provisioner(),
      now: () => "2026-06-30T08:30:00.000Z"
    });

    const result = await service.provisionTenant(tenantInput());

    expect(result.tenant).toMatchObject({
      id: "tenant_acme_ai",
      name: "Acme AI",
      status: "active",
      region: "us-east-1",
      plan: "team",
      admin: { email: "admin@example.com", role: "admin" }
    });
    expect(result.tenant.resources).toMatchObject({
      databaseUrlRef: "secret://tenant_acme_ai/DATABASE_URL",
      storageBucket: "tenant_acme_ai-objects",
      queueUrlRef: "secret://tenant_acme_ai/REDIS_URL",
      encryptionKeyRef: "kms://tenant_acme_ai/primary"
    });
    expect(result.tenant.isolation.storagePrefix).toBe("tenants/tenant_acme_ai/");
    expect(result.tenant.composioHandoff).toMatchObject({ projectId: "composio-acme", apiKeyConfigured: true, status: "ready" });
    expect(result.tenant.diagnostics.every((check) => check.status === "passed")).toBe(true);
    expect(result.tenant.firstConnectedSource.nextAction).toMatch(/Composio/i);
    expect(result.auditEvents.map((event) => event.action)).toContain("cloud.tenant.provision");
  });

  it("rolls back failed provisioning and audits the failure", async () => {
    const store = memoryStore();
    const service = createCloudControlPlane({
      store,
      provisioner: provisioner({
        async provision() {
          throw new Error("queue service unavailable");
        }
      }),
      now: () => "2026-06-30T08:30:00.000Z"
    });

    const result = await service.provisionTenant(tenantInput());

    expect(result.tenant.status).toBe("rolled-back");
    expect(result.tenant.failureReason).toMatch(/queue service unavailable/i);
    expect(result.rollback?.rolledBack).toBe(true);
    expect(store.snapshot()?.auditEvents.map((event) => event.action)).toEqual(expect.arrayContaining(["cloud.tenant.rollback"]));
  });

  it("enforces tenant isolation and audits denied access", async () => {
    const store = memoryStore();
    const service = createCloudControlPlane({ store, provisioner: provisioner(), now: () => "2026-06-30T08:30:00.000Z" });
    await service.provisionTenant(tenantInput());
    await service.provisionTenant({ ...tenantInput(), tenantName: "Other Org", adminEmail: "other@example.com", composioProjectId: "composio-other" });

    const allowed = await service.assertTenantAccess({ principal: tenantOperator, tenantId: "tenant_acme_ai" });
    const denied = await service.assertTenantAccess({ principal: outsider, tenantId: "tenant_acme_ai" });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(denied.reasons.join(" ")).toMatch(/tenant_acme_ai/i);
    expect(store.snapshot()?.auditEvents.find((event) => event.action === "cloud.access.check" && event.policyDecision === "deny")).toBeDefined();
  });

  it("rotates tenant secret references", async () => {
    const service = createCloudControlPlane({ store: memoryStore(), provisioner: provisioner(), now: () => "2026-06-30T08:30:00.000Z" });
    await service.provisionTenant(tenantInput());

    const result = await service.rotateSecret({ principal: tenantOperator, tenantId: "tenant_acme_ai", secretName: "DATABASE_URL" });

    expect(result.rotation).toMatchObject({
      tenantId: "tenant_acme_ai",
      secretName: "DATABASE_URL",
      status: "rotated"
    });
    expect(result.rotation.newRef).toMatch(/DATABASE_URL:v2/);
    expect(result.tenant.resources.databaseUrlRef).toBe(result.rotation.newRef);
  });

  it("exports cloud tenant data in self-host-compatible formats", async () => {
    const service = createCloudControlPlane({ store: memoryStore(), provisioner: provisioner(), now: () => "2026-06-30T08:30:00.000Z" });
    await service.provisionTenant(tenantInput());

    const result = await service.exportForSelfHost({ principal: tenantOperator, tenantId: "tenant_acme_ai" });

    expect(result.exportRecord.formatVersion).toBe("company-brain-cloud-export-v1");
    expect(result.exportRecord.contract).toMatchObject({
      apiBasePath: "/api/v1",
      mcpPath: "/api/mcp",
      registryPackageFormat: "canonical-registry-package-v1",
      dataExportFormat: "company-brain-export-v1"
    });
    expect(result.exportRecord.payload.setupState).toMatchObject({
      isComplete: true,
      tenant: { id: "tenant_acme_ai", name: "Acme AI" },
      settings: { composioProjectId: "composio-acme", composioApiKeyConfigured: true }
    });
    expect(result.exportRecord.payload.helmValues.secrets.values.DATABASE_URL).toBe("secret://tenant_acme_ai/DATABASE_URL");
  });

  it("serves tenant create/list, diagnostics, secret rotation, and self-host export routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-cloud-"));
    process.env.CLOUD_CONTROL_STATE_PATH = join(dir, "cloud.json");
    vi.resetModules();

    const tenantsRoute = await import("../app/api/v1/cloud/tenants/route");
    const diagnosticsRoute = await import("../app/api/v1/cloud/tenants/[id]/diagnostics/route");
    const rotateRoute = await import("../app/api/v1/cloud/tenants/[id]/secrets/rotate/route");
    const exportRoute = await import("../app/api/v1/cloud/tenants/[id]/export/route");

    const created = await tenantsRoute.POST(jsonRequest("/api/v1/cloud/tenants", tenantInput()));
    expect(created.status).toBe(200);

    const listed = await tenantsRoute.GET();
    const listBody = await listed.json();
    expect(listBody.tenants).toHaveLength(1);

    const diagnostics = await diagnosticsRoute.GET(new Request("http://localhost/api/v1/cloud/tenants/tenant_acme_ai/diagnostics"), {
      params: Promise.resolve({ id: "tenant_acme_ai" })
    });
    const diagnosticsBody = await diagnostics.json();
    expect(diagnosticsBody.diagnostics.every((check: { status: string }) => check.status === "passed")).toBe(true);

    const rotated = await rotateRoute.POST(
      jsonRequest("/api/v1/cloud/tenants/tenant_acme_ai/secrets/rotate", { principal: tenantOperator, secretName: "REDIS_URL" }),
      { params: Promise.resolve({ id: "tenant_acme_ai" }) }
    );
    expect(rotated.status).toBe(200);

    const exported = await exportRoute.GET(new Request("http://localhost/api/v1/cloud/tenants/tenant_acme_ai/export?principalId=usr_operator"), {
      params: Promise.resolve({ id: "tenant_acme_ai" })
    });
    const exportBody = await exported.json();
    expect(exportBody.exportRecord.contract.apiBasePath).toBe("/api/v1");
  });
});
