import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveSetupPlan, bootstrapTenant, getSetupState } from "../lib/setup";
import { brainTiers } from "../lib/types";

function tempStatePath() {
  return join(mkdtempSync(join(tmpdir(), "company-brain-setup-")), "setup-state.json");
}

const validInput = {
  tenantName: "Acme AI",
  adminName: "Admin User",
  adminEmail: "admin@example.com",
  encryptionKey: "test-encryption-key",
  composioProjectId: "composio-project",
  composioApiKeyConfigured: true
};

function jsonRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

describe("setup bootstrap store", () => {
  it("returns incomplete setup state for a fresh deployment", () => {
    const state = getSetupState({ storagePath: tempStatePath() });

    expect(state).toEqual({
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
    });
  });

  it("bootstraps tenant, onboarding profile, org map, preflights, tiers, and audit events", () => {
    const storagePath = tempStatePath();
    const bootstrapped = bootstrapTenant(
      {
        ...validInput,
        companyDescription: "AI ops company.",
        departments: "Product, Operations",
        teams: "Platform, Support",
        goals: "Automate weekly reporting\nImprove source-backed decisions",
        challenges: "Disconnected docs",
        sensitiveAreas: "exec planning",
        selectedConnectors: ["slack", "linear"],
        selectedBrainTiers: ["individual", "team", "department", "company-main", "exec-protected"]
      },
      {
        storagePath,
        now: () => "2026-06-29T12:00:00.000Z"
      }
    );

    expect(bootstrapped.isComplete).toBe(true);
    expect(bootstrapped.tenant).toMatchObject({
      id: "tenant_acme_ai",
      name: "Acme AI"
    });
    expect(bootstrapped.admin).toMatchObject({
      id: "usr_admin",
      name: "Admin User",
      email: "admin@example.com",
      role: "admin"
    });
    expect(bootstrapped.settings).toMatchObject({
      encryptionKeyConfigured: true,
      composioProjectId: "composio-project",
      composioApiKeyConfigured: true
    });
    expect(bootstrapped.brainTiers).toEqual([...brainTiers]);
    expect(bootstrapped.onboarding).toMatchObject({
      mode: "supabase-local",
      status: "active",
      selectedConnectors: ["slack", "linear"],
      selectedBrainTiers: ["individual", "team", "department", "company-main", "exec-protected"]
    });
    expect(bootstrapped.orgUnits.map((unit) => unit.kind)).toEqual(["company", "department", "department", "team", "team", "exec-protected"]);
    expect(bootstrapped.orgMemberships).toHaveLength(bootstrapped.orgUnits.length);
    expect(bootstrapped.brainLevelConfigs.find((config) => config.tier === "exec-protected")).toMatchObject({
      enabled: true,
      ownerId: "usr_admin",
      reviewerIds: ["usr_admin"],
      allowedRoles: ["admin", "reviewer"]
    });
    expect(bootstrapped.supabase).toMatchObject({
      mode: "supabase-local",
      ready: true
    });
    expect(bootstrapped.connectorPreflights).toHaveLength(2);
    expect(bootstrapped.setupRecommendations.every((recommendation) => recommendation.status === "approved")).toBe(true);
    expect(bootstrapped.auditEvents.map((event) => event.action)).toEqual([
      "tenant.bootstrap",
      "admin.bootstrap",
      "onboarding.plan.generated",
      "onboarding.plan.approved"
    ]);

    const persisted = JSON.parse(readFileSync(storagePath, "utf8"));
    expect(persisted.tenant.name).toBe("Acme AI");
  });

  it("persists setup state across reads", () => {
    const storagePath = tempStatePath();

    bootstrapTenant(validInput, {
      storagePath,
      now: () => "2026-06-29T12:00:00.000Z"
    });

    const reloaded = getSetupState({ storagePath });
    expect(reloaded.isComplete).toBe(true);
    expect(reloaded.tenant?.name).toBe("Acme AI");
    expect(reloaded.admin?.email).toBe("admin@example.com");
    expect(reloaded.auditEvents).toHaveLength(4);
    expect(reloaded.setupTasks.map((task) => task.id)).toEqual(["mode", "describe", "supabase-preflight", "connector-preflight", "review-plan", "activate"]);
  });

  it("rejects duplicate bootstrap attempts", () => {
    const storagePath = tempStatePath();

    bootstrapTenant(validInput, { storagePath });

    expect(() => bootstrapTenant(validInput, { storagePath })).toThrow(/already bootstrapped/i);
  });

  it("validates required bootstrap fields", () => {
    expect(() =>
      bootstrapTenant(
        {
          ...validInput,
          tenantName: "",
          adminEmail: "not-an-email"
        },
        { storagePath: tempStatePath() }
      )
    ).toThrow(/tenant name/i);
  });

  it("requires a Supabase project ref for cloud mode", () => {
    expect(() =>
      bootstrapTenant(
        {
          ...validInput,
          mode: "supabase-cloud"
        },
        { storagePath: tempStatePath() }
      )
    ).toThrow(/supabase project ref/i);
  });

  it("keeps a generated setup plan pending until approval", () => {
    const storagePath = tempStatePath();

    const draft = bootstrapTenant(
      {
        ...validInput,
        approveSetupPlan: false,
        selectedConnectors: ["slack"],
        selectedBrainTiers: ["individual", "team", "department", "company-main"]
      },
      {
        storagePath,
        now: () => "2026-06-29T12:00:00.000Z"
      }
    );

    expect(draft.isComplete).toBe(false);
    expect(draft.onboarding?.status).toBe("plan-ready");
    expect(draft.setupRecommendations.every((recommendation) => recommendation.status === "pending")).toBe(true);

    const approved = approveSetupPlan({
      storagePath,
      now: () => "2026-06-29T12:05:00.000Z"
    });

    expect(approved.isComplete).toBe(true);
    expect(approved.onboarding?.status).toBe("active");
    expect(approved.setupTasks.find((task) => task.id === "activate")?.status).toBe("completed");
    expect(approved.setupRecommendations.every((recommendation) => recommendation.status === "approved")).toBe(true);
    expect(approved.auditEvents[0]).toMatchObject({
      action: "onboarding.plan.approved",
      createdAt: "2026-06-29T12:05:00.000Z"
    });
  });

  it("blocks broad activation when connector credentials are missing", () => {
    const state = bootstrapTenant(
      {
        ...validInput,
        composioApiKeyConfigured: false,
        selectedConnectors: ["slack", "github"]
      },
      { storagePath: tempStatePath() }
    );

    expect(state.isComplete).toBe(false);
    expect(state.onboarding?.status).toBe("blocked");
    expect(state.connectorPreflights.map((preflight) => preflight.status)).toEqual(["needs-scope", "needs-scope"]);
    expect(state.connectorPreflights.flatMap((preflight) => preflight.missingScopes)).toEqual(["COMPOSIO_API_KEY", "COMPOSIO_API_KEY"]);
    expect(state.setupTasks.find((task) => task.id === "connector-preflight")).toMatchObject({
      status: "blocked",
      retryable: true
    });
  });

  it("exposes setup, preflight, and approval APIs for resumable onboarding", async () => {
    const storagePath = tempStatePath();
    const previousPath = process.env.COMPANY_BRAIN_SETUP_PATH;
    process.env.COMPANY_BRAIN_SETUP_PATH = storagePath;

    try {
      const [setupRoute, approveRoute, connectorPreflightRoute, supabasePreflightRoute] = await Promise.all([
        import("../app/api/v1/setup/route"),
        import("../app/api/v1/setup/approve/route"),
        import("../app/api/v1/setup/connectors/preflight/route"),
        import("../app/api/v1/setup/supabase/preflight/route")
      ]);

      const response = await setupRoute.POST(
        jsonRequest("/api/v1/setup", {
          ...validInput,
          approveSetupPlan: false,
          selectedConnectors: ["linear"],
          selectedBrainTiers: ["team", "department", "company-main"]
        })
      );
      expect(response.status).toBe(201);
      const payload = await response.json();
      expect(payload.onboarding.status).toBe("plan-ready");

      const connectorResponse = await connectorPreflightRoute.GET();
      expect(await connectorResponse.json()).toMatchObject({
        onboardingStatus: "plan-ready",
        connectorPreflights: [
          {
            connector: "linear",
            status: "ready"
          }
        ]
      });

      const supabaseResponse = await supabasePreflightRoute.GET();
      expect(await supabaseResponse.json()).toMatchObject({
        onboardingStatus: "plan-ready",
        supabase: {
          mode: "supabase-local",
          ready: true
        }
      });

      const approvedResponse = await approveRoute.POST();
      expect(approvedResponse.status).toBe(200);
      const approvedPayload = await approvedResponse.json();
      expect(approvedPayload.isComplete).toBe(true);
      expect(approvedPayload.onboarding.status).toBe("active");
    } finally {
      if (previousPath === undefined) {
        delete process.env.COMPANY_BRAIN_SETUP_PATH;
      } else {
        process.env.COMPANY_BRAIN_SETUP_PATH = previousPath;
      }
    }
  });
});
