import { describe, expect, it, vi } from "vitest";
import { createComposioControlPlane, type ComposioApiClient, type ComposioState, type ComposioStateStore } from "../lib/composio-control-plane";

function createMemoryStore(initial?: Partial<ComposioState>) {
  let state: ComposioState | null = initial
    ? {
        config: null,
        connectedAccounts: [],
        sessions: [],
        registryCandidates: [],
        auditEvents: [],
        ...initial
      }
    : null;

  const store: ComposioStateStore & { snapshot: () => ComposioState | null } = {
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

function createFakeClient(overrides: Partial<ComposioApiClient> = {}) {
  const client: ComposioApiClient & { createdSessions: string[] } = {
    createdSessions: [],
    async validateConfiguration() {
      return { ok: true, authConfigs: [{ id: "auth_slack", toolkitSlug: "slack", name: "Slack OAuth" }] };
    },
    async createConnectedAccountLink(input) {
      return {
        connectedAccountId: `acct_${input.toolkitSlug}`,
        status: "active",
        connectUrl: `https://backend.composio.dev/connect/${input.toolkitSlug}`,
        externalUserId: input.principalId
      };
    },
    async testConnectedAccount() {
      return { ok: true, status: "active" };
    },
    async refreshConnectedAccount() {
      return { status: "active" };
    },
    async revokeConnectedAccount() {
      return { status: "revoked" };
    },
    async createSession(input) {
      const id = `session_${this.createdSessions.length + 1}`;
      this.createdSessions.push(id);
      return {
        id,
        status: "active",
        principalId: input.principalId,
        purpose: input.purpose,
        toolkitSlugs: input.toolkitSlugs,
        connectedAccountIds: input.connectedAccountIds
      };
    },
    async discoverToolkitActions(input) {
      if (input.toolkitSlugs.includes("missing")) {
        throw new Error("Toolkit missing is unavailable");
      }

      return input.toolkitSlugs.flatMap((toolkitSlug) => [
        {
          id: `${toolkitSlug}_send_message`,
          toolkitSlug,
          slug: "send-message",
          name: "Send message",
          description: "Send a message through the connected account.",
          inputSchema: { type: "object" }
        },
        {
          id: `${toolkitSlug}_search`,
          toolkitSlug,
          slug: "search",
          name: "Search",
          description: "Search records available to the connected account.",
          inputSchema: { type: "object" }
        }
      ]);
    },
    ...overrides
  };

  return client;
}

describe("Composio control plane", () => {
  it("rejects missing API credentials before network validation", async () => {
    const apiClient = createFakeClient({
      validateConfiguration: vi.fn()
    });
    const controlPlane = createComposioControlPlane({ store: createMemoryStore(), apiClient });

    await expect(
      controlPlane.configure({
        projectId: "proj_123",
        apiKeyConfigured: false
      })
    ).rejects.toThrow(/api key/i);

    expect(apiClient.validateConfiguration).not.toHaveBeenCalled();
  });

  it("manages connected-account test, refresh, revoke, and reauthorize lifecycle", async () => {
    const controlPlane = createComposioControlPlane({
      store: createMemoryStore(),
      apiClient: createFakeClient(),
      now: () => "2026-06-29T12:00:00.000Z"
    });

    await controlPlane.configure({ projectId: "proj_123", apiKey: "test-key", apiKeyConfigured: true });
    const account = await controlPlane.initiateConnectedAccount({
      toolkitSlug: "slack",
      authConfigId: "auth_slack",
      principalId: "usr_admin"
    });
    const tested = await controlPlane.testConnectedAccount(account.id);
    const refreshed = await controlPlane.refreshConnectedAccount(account.id);
    const revoked = await controlPlane.revokeConnectedAccount(account.id);
    const reauthorized = await controlPlane.reauthorizeConnectedAccount(account.id);

    expect(tested.status).toBe("active");
    expect(refreshed.status).toBe("active");
    expect(revoked.status).toBe("revoked");
    expect(reauthorized.status).toBe("pending");
  });

  it("reuses active sessions for the same principal, purpose, toolkits, and accounts", async () => {
    const apiClient = createFakeClient();
    const controlPlane = createComposioControlPlane({ store: createMemoryStore(), apiClient });

    await controlPlane.configure({ projectId: "proj_123", apiKey: "test-key", apiKeyConfigured: true });
    const account = await controlPlane.initiateConnectedAccount({
      toolkitSlug: "slack",
      authConfigId: "auth_slack",
      principalId: "usr_admin"
    });
    const first = await controlPlane.getOrCreateSession({
      principalId: "usr_admin",
      purpose: "interactive-agent",
      toolkitSlugs: ["slack"],
      connectedAccountIds: [account.id]
    });
    const second = await controlPlane.getOrCreateSession({
      principalId: "usr_admin",
      purpose: "interactive-agent",
      toolkitSlugs: ["slack"],
      connectedAccountIds: [account.id]
    });

    expect(second.id).toBe(first.id);
    expect(apiClient.createdSessions).toHaveLength(1);
  });

  it("blocks sessions that reference revoked connected accounts", async () => {
    const controlPlane = createComposioControlPlane({ store: createMemoryStore(), apiClient: createFakeClient() });

    await controlPlane.configure({ projectId: "proj_123", apiKey: "test-key", apiKeyConfigured: true });
    const account = await controlPlane.initiateConnectedAccount({
      toolkitSlug: "slack",
      authConfigId: "auth_slack",
      principalId: "usr_admin"
    });
    await controlPlane.revokeConnectedAccount(account.id);

    await expect(
      controlPlane.getOrCreateSession({
        principalId: "usr_admin",
        purpose: "connector-worker",
        toolkitSlugs: ["slack"],
        connectedAccountIds: [account.id]
      })
    ).rejects.toThrow(/revoked/i);
  });

  it("surfaces unavailable toolkit discovery failures", async () => {
    const controlPlane = createComposioControlPlane({ store: createMemoryStore(), apiClient: createFakeClient() });

    await controlPlane.configure({ projectId: "proj_123", apiKey: "test-key", apiKeyConfigured: true });

    await expect(
      controlPlane.discoverToolkitActions({
        toolkitSlugs: ["missing"],
        ownerId: "usr_admin",
        tier: "team"
      })
    ).rejects.toThrow(/unavailable/i);
  });

  it("stores discovered actions as internal registry tool candidates", async () => {
    const store = createMemoryStore();
    const controlPlane = createComposioControlPlane({
      store,
      apiClient: createFakeClient(),
      now: () => "2026-06-29T12:00:00.000Z"
    });

    await controlPlane.configure({ projectId: "proj_123", apiKey: "test-key", apiKeyConfigured: true });
    const result = await controlPlane.discoverToolkitActions({
      toolkitSlugs: ["slack"],
      ownerId: "usr_admin",
      tier: "team"
    });

    expect(result.registryCandidates).toHaveLength(2);
    expect(result.registryCandidates[0]).toMatchObject({
      kind: "tool",
      toolType: "connector",
      status: "review",
      permissions: ["composio:slack:execute"],
      ownerId: "usr_admin",
      tier: "team",
      auditPolicy: "log-metadata"
    });
    expect(store.snapshot()?.registryCandidates).toHaveLength(2);
  });
});
