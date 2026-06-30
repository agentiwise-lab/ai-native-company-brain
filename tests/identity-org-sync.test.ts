import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIdentityOrgSync, type IdentityOrgState, type IdentityOrgStore, type ScimEvent } from "../lib/identity-org-sync";
import { createToolInvocationGateway, type ToolInvocationState, type ToolInvocationStore } from "../lib/tool-invocation-gateway";
import type { ComposioState } from "../lib/composio-control-plane";
import type { Principal, RegistryItem, ToolDefinition } from "../lib/types";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "brain:write", "audit:read", "tool:invoke"]
};

function identityStore() {
  let state: IdentityOrgState | null = null;
  const store: IdentityOrgStore & { snapshot: () => IdentityOrgState | null } = {
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

function invocationStore() {
  let state: ToolInvocationState | null = null;
  const store: ToolInvocationStore & { snapshot: () => ToolInvocationState | null } = {
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

function controlState(): ComposioState {
  return {
    config: null,
    connectedAccounts: [
      {
        id: "acct_salesforce",
        toolkitSlug: "salesforce",
        authConfigId: "auth_salesforce",
        principalId: "usr_asha",
        status: "active",
        createdAt: "2026-06-30T07:00:00.000Z",
        updatedAt: "2026-06-30T07:00:00.000Z"
      }
    ],
    sessions: [
      {
        id: "sess_salesforce",
        principalId: "usr_asha",
        purpose: "interactive-agent",
        toolkitSlugs: ["salesforce"],
        connectedAccountIds: ["acct_salesforce"],
        status: "active",
        createdAt: "2026-06-30T07:00:00.000Z"
      }
    ],
    registryCandidates: [],
    auditEvents: []
  };
}

function tool(): ToolDefinition {
  return {
    id: "tool_salesforce_read",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Salesforce read",
    slug: "salesforce-read",
    description: "Read Salesforce through Composio.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["composio:salesforce:execute"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["generic-mcp"],
    updatedAt: "2026-06-30T07:00:00.000Z",
    toolType: "connector",
    inputSchema: {},
    rateLimit: "60/minute",
    secrets: ["COMPOSIO_API_KEY"],
    auditPolicy: "log-metadata"
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("identity org sync", () => {
  it("configures SAML and SCIM with audit events", async () => {
    const service = createIdentityOrgSync({ store: identityStore(), now: () => "2026-06-30T07:00:00.000Z" });

    const result = await service.configure({
      principal: admin,
      saml: { entityId: "https://idp.example.com", ssoUrl: "https://idp.example.com/sso", certificateFingerprint: "sha256:abc" },
      scim: { baseUrl: "https://brain.example.com/scim/v2", tokenConfigured: true }
    });

    expect(result.config?.saml.entityId).toBe("https://idp.example.com");
    expect(result.auditEvents[0]).toMatchObject({ action: "identity.configure", policyDecision: "allow" });
  });

  it("syncs user create/update/deactivate and derives access from group mappings", async () => {
    const service = createIdentityOrgSync({ store: identityStore(), now: () => "2026-06-30T07:00:00.000Z" });
    await service.syncScim({
      principal: admin,
      events: [
        {
          id: "evt_group_revenue",
          type: "group.upsert",
          group: {
            id: "grp_revenue",
            displayName: "Revenue Reviewers",
            teams: ["revenue"],
            tiers: ["individual", "team", "department"],
            role: "reviewer",
            scopes: ["brain:read", "registry:read", "tool:invoke"],
            reviewerForTiers: ["team"]
          }
        },
        {
          id: "evt_user_asha",
          type: "user.upsert",
          user: {
            id: "usr_asha",
            externalId: "okta_asha",
            email: "asha@example.com",
            name: "Asha Rao",
            active: true,
            groupIds: ["grp_revenue"]
          }
        }
      ]
    });

    const principal = await service.principalForUser("usr_asha");
    expect(principal).toMatchObject({
      id: "usr_asha",
      role: "reviewer",
      teams: ["revenue"],
      tiers: ["individual", "team", "department"]
    });
    expect(service.visibleRegistryItems(principal, [{ id: "tool_salesforce_read", tier: "department" } as RegistryItem])).toHaveLength(1);

    await service.syncScim({
      principal: admin,
      events: [{ id: "evt_deactivate_asha", type: "user.deactivate", userId: "usr_asha" }]
    });
    await expect(service.principalForUser("usr_asha")).rejects.toThrow(/deactivated/i);
    expect((await service.accessDecision("usr_asha", "api")).allowed).toBe(false);
  });

  it("updates group mappings and remaps reviewer ownership", async () => {
    const service = createIdentityOrgSync({ store: identityStore(), now: () => "2026-06-30T07:00:00.000Z" });
    await service.syncScim({
      principal: admin,
      events: [
        {
          id: "evt_group_reviewers",
          type: "group.upsert",
          group: {
            id: "grp_reviewers",
            displayName: "Platform Reviewers",
            teams: ["platform"],
            tiers: ["individual", "team", "company-main"],
            role: "reviewer",
            scopes: ["brain:read", "registry:read", "registry:review", "tool:invoke"],
            reviewerForTiers: ["team", "company-main"]
          }
        },
        {
          id: "evt_user_primary",
          type: "user.upsert",
          user: { id: "usr_primary", externalId: "okta_primary", email: "primary@example.com", name: "Primary", active: true, groupIds: ["grp_reviewers"] }
        },
        {
          id: "evt_user_backup",
          type: "user.upsert",
          user: { id: "usr_backup", externalId: "okta_backup", email: "backup@example.com", name: "Backup", active: true, groupIds: ["grp_reviewers"] }
        }
      ]
    });

    expect((await service.reviewerForTier("company-main"))?.id).toBe("usr_primary");
    await service.syncScim({ principal: admin, events: [{ id: "evt_deactivate_primary", type: "user.deactivate", userId: "usr_primary" }] });

    expect((await service.reviewerForTier("company-main"))?.id).toBe("usr_backup");
  });

  it("denies stale Composio session/tool execution for deactivated users", async () => {
    const service = createIdentityOrgSync({ store: identityStore(), now: () => "2026-06-30T07:00:00.000Z" });
    await service.syncScim({
      principal: admin,
      events: [
        {
          id: "evt_group_tools",
          type: "group.upsert",
          group: {
            id: "grp_tools",
            displayName: "Tool users",
            teams: ["revenue"],
            tiers: ["individual", "team"],
            role: "operator",
            scopes: ["brain:read", "tool:invoke"],
            reviewerForTiers: []
          }
        },
        {
          id: "evt_user_asha",
          type: "user.upsert",
          user: { id: "usr_asha", externalId: "okta_asha", email: "asha@example.com", name: "Asha", active: true, groupIds: ["grp_tools"] }
        },
        { id: "evt_deactivate_asha", type: "user.deactivate", userId: "usr_asha" }
      ]
    });
    const stalePrincipal: Principal = {
      id: "usr_asha",
      name: "Asha",
      email: "asha@example.com",
      role: "operator",
      teams: ["revenue"],
      tiers: ["individual", "team"],
      scopes: ["brain:read", "tool:invoke"]
    };
    const gateway = createToolInvocationGateway({
      store: invocationStore(),
      controlPlane: { getState: async () => controlState() },
      identityProvider: service,
      executor: vi.fn(async () => ({ ok: true }))
    });

    const result = await gateway.invoke({
      principal: stalePrincipal,
      tool: tool(),
      connectedAccountId: "acct_salesforce",
      sessionPurpose: "interactive-agent",
      packageVersion: "1.0.0",
      args: {},
      budgetUsd: 1
    });

    expect(result.status).toBe("denied");
    expect(result.decision.reasons.join(" ")).toMatch(/deactivated/i);
  });

  it("suppresses duplicate SCIM replay effects", async () => {
    const store = identityStore();
    const service = createIdentityOrgSync({ store, now: () => "2026-06-30T07:00:00.000Z" });
    const event: ScimEvent = {
      id: "evt_group_replay",
      type: "group.upsert" as const,
      group: {
        id: "grp_replay",
        displayName: "Replay Group",
        teams: ["platform"],
        tiers: ["individual", "team"],
        role: "employee" as const,
        scopes: ["brain:read"],
        reviewerForTiers: []
      }
    };

    const first = await service.syncScim({ principal: admin, events: [event] });
    const second = await service.syncScim({ principal: admin, events: [event] });

    expect(first.appliedEvents).toBe(1);
    expect(second.appliedEvents).toBe(0);
    expect(second.duplicatesSuppressed).toBe(1);
    expect(store.snapshot()?.auditEvents.filter((audit) => audit.action === "identity.scim.sync")).toHaveLength(1);
  });

  it("serves configure, SCIM sync, and status through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-identity-"));
    process.env.IDENTITY_ORG_STATE_PATH = join(dir, "identity.json");
    vi.resetModules();
    const configureRoute = await import("../app/api/v1/identity/configure/route");
    const syncRoute = await import("../app/api/v1/identity/scim/sync/route");
    const statusRoute = await import("../app/api/v1/identity/status/route");

    const configured = await configureRoute.POST(
      jsonRequest("/api/v1/identity/configure", {
        principal: admin,
        saml: { entityId: "https://idp.example.com", ssoUrl: "https://idp.example.com/sso", certificateFingerprint: "sha256:abc" },
        scim: { baseUrl: "https://brain.example.com/scim/v2", tokenConfigured: true }
      })
    );
    const synced = await syncRoute.POST(
      jsonRequest("/api/v1/identity/scim/sync", {
        principal: admin,
        events: [
          {
            id: "evt_group_api",
            type: "group.upsert",
            group: {
              id: "grp_api",
              displayName: "API Users",
              teams: ["platform"],
              tiers: ["individual", "team"],
              role: "employee",
              scopes: ["brain:read"],
              reviewerForTiers: []
            }
          }
        ]
      })
    );
    const status = await statusRoute.GET();
    const state = await status.json();

    expect(configured.status).toBe(200);
    expect(synced.status).toBe(200);
    expect(state.groups).toHaveLength(1);
    expect(state.auditEvents.length).toBeGreaterThan(0);
  });
});
