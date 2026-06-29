import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapTenant, getSetupState } from "../lib/setup";
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

describe("setup bootstrap store", () => {
  it("returns incomplete setup state for a fresh deployment", () => {
    const state = getSetupState({ storagePath: tempStatePath() });

    expect(state).toEqual({
      isComplete: false,
      tenant: null,
      admin: null,
      settings: null,
      brainTiers: [...brainTiers],
      auditEvents: []
    });
  });

  it("bootstraps tenant, admin, settings, tiers, and audit events", () => {
    const storagePath = tempStatePath();
    const bootstrapped = bootstrapTenant(validInput, {
      storagePath,
      now: () => "2026-06-29T12:00:00.000Z"
    });

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
    expect(bootstrapped.auditEvents.map((event) => event.action)).toEqual(["tenant.bootstrap", "admin.bootstrap"]);

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
    expect(reloaded.auditEvents).toHaveLength(2);
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
});

