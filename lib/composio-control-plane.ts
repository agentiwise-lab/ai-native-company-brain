import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrainTier, ToolDefinition } from "./types";

export type ComposioConfig = {
  projectId: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyRef: "request" | "COMPOSIO_API_KEY";
  authConfigCount: number;
  validatedAt: string;
  updatedAt: string;
};

export type ComposioConnectedAccountStatus = "pending" | "active" | "revoked" | "errored";

export type ComposioConnectedAccount = {
  id: string;
  toolkitSlug: string;
  authConfigId: string;
  principalId: string;
  externalUserId?: string;
  status: ComposioConnectedAccountStatus;
  connectUrl?: string;
  lastTestedAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ComposioSessionPurpose = "interactive-agent" | "connector-worker" | "cron-job";

export type ComposioSession = {
  id: string;
  principalId: string;
  purpose: ComposioSessionPurpose;
  toolkitSlugs: string[];
  connectedAccountIds: string[];
  status: "active" | "expired" | "revoked";
  createdAt: string;
  reusedAt?: string;
};

export type ComposioToolkitAction = {
  id: string;
  toolkitSlug: string;
  slug: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ComposioAuditEvent = {
  id: string;
  action:
    | "composio.config.validated"
    | "composio.account.initiated"
    | "composio.account.tested"
    | "composio.account.refreshed"
    | "composio.account.revoked"
    | "composio.account.reauthorized"
    | "composio.session.created"
    | "composio.session.reused"
    | "composio.toolkits.discovered";
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ComposioState = {
  config: ComposioConfig | null;
  connectedAccounts: ComposioConnectedAccount[];
  sessions: ComposioSession[];
  registryCandidates: ToolDefinition[];
  auditEvents: ComposioAuditEvent[];
};

export type ComposioStateStore = {
  read(): Promise<ComposioState | null>;
  write(state: ComposioState): Promise<void>;
};

export type ComposioApiClient = {
  validateConfiguration(input: { projectId: string; baseUrl: string; apiKey?: string }): Promise<{
    ok: boolean;
    authConfigs?: Array<{ id: string; toolkitSlug: string; name: string }>;
  }>;
  createConnectedAccountLink(input: {
    toolkitSlug: string;
    authConfigId: string;
    principalId: string;
  }): Promise<{
    connectedAccountId?: string;
    status?: ComposioConnectedAccountStatus;
    connectUrl?: string;
    externalUserId?: string;
  }>;
  testConnectedAccount(id: string): Promise<{ ok: boolean; status?: ComposioConnectedAccountStatus }>;
  refreshConnectedAccount(id: string): Promise<{ status?: ComposioConnectedAccountStatus }>;
  revokeConnectedAccount(id: string): Promise<{ status?: ComposioConnectedAccountStatus }>;
  createSession(input: {
    principalId: string;
    purpose: ComposioSessionPurpose;
    toolkitSlugs: string[];
    connectedAccountIds: string[];
  }): Promise<{
    id: string;
    status?: ComposioSession["status"];
    principalId?: string;
    purpose?: ComposioSessionPurpose;
    toolkitSlugs?: string[];
    connectedAccountIds?: string[];
  }>;
  discoverToolkitActions(input: { toolkitSlugs: string[] }): Promise<ComposioToolkitAction[]>;
};

export type ConfigureComposioInput = {
  projectId: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
};

type ControlPlaneOptions = {
  store?: ComposioStateStore;
  apiClient?: ComposioApiClient;
  now?: () => string;
  id?: (prefix: string) => string;
};

const defaultBaseUrl = "https://backend.composio.dev";
const defaultTenantId = "tenant_demo";

function defaultState(): ComposioState {
  return {
    config: null,
    connectedAccounts: [],
    sessions: [],
    registryCandidates: [],
    auditEvents: []
  };
}

function defaultStatePath() {
  return process.env.COMPOSIO_STATE_PATH ?? join(process.cwd(), "data", "composio-state.json");
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sameSet(a: string[], b: string[]) {
  return [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
}

function normalizeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireAccount(state: ComposioState, accountId: string) {
  const account = state.connectedAccounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    throw new Error(`Connected account ${accountId} was not found.`);
  }
  return account;
}

function createFileStore(path = defaultStatePath()): ComposioStateStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ComposioState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio API failed with ${response.status}: ${text || response.statusText}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function arrayFromPayload(payload: Record<string, unknown>) {
  const items = payload.items ?? payload.data ?? payload.auth_configs ?? payload.tools ?? payload.toolkits;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

export function createComposioRestClient(input: { apiKey?: string; baseUrl?: string } = {}): ComposioApiClient {
  const baseUrl = input.baseUrl ?? process.env.COMPOSIO_BASE_URL ?? defaultBaseUrl;
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;

  async function request(path: string, init: RequestInit = {}) {
    if (!apiKey) {
      throw new Error("Composio API key is required.");
    }

    return readJson(
      await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          ...(init.headers ?? {})
        }
      })
    );
  }

  return {
    async validateConfiguration() {
      const payload = await request("/api/v3.1/auth_configs");
      const authConfigs = arrayFromPayload(payload).map((item) => ({
        id: String(item.id ?? item.auth_config_id),
        toolkitSlug: String(item.toolkit_slug ?? item.toolkit ?? item.appName ?? "unknown"),
        name: String(item.name ?? item.display_name ?? item.id)
      }));
      return { ok: true, authConfigs };
    },

    async createConnectedAccountLink(params) {
      const payload = await request("/api/v3.1/connected_accounts/link", {
        method: "POST",
        body: JSON.stringify({
          toolkit_slug: params.toolkitSlug,
          auth_config_id: params.authConfigId,
          external_user_id: params.principalId
        })
      });

      return {
        connectedAccountId: String(payload.connected_account_id ?? payload.id ?? ""),
        status: (payload.status as ComposioConnectedAccountStatus | undefined) ?? "pending",
        connectUrl: typeof payload.redirect_url === "string" ? payload.redirect_url : typeof payload.connect_url === "string" ? payload.connect_url : undefined,
        externalUserId: params.principalId
      };
    },

    async testConnectedAccount(id) {
      const payload = await request(`/api/v3.1/connected_accounts/${id}`);
      return {
        ok: String(payload.status ?? "active") !== "revoked",
        status: (payload.status as ComposioConnectedAccountStatus | undefined) ?? "active"
      };
    },

    async refreshConnectedAccount(id) {
      const payload = await request(`/api/v3.1/connected_accounts/${id}/refresh`, { method: "POST" });
      return { status: (payload.status as ComposioConnectedAccountStatus | undefined) ?? "active" };
    },

    async revokeConnectedAccount(id) {
      const payload = await request(`/api/v3.1/connected_accounts/${id}/revoke`, { method: "POST" });
      return { status: (payload.status as ComposioConnectedAccountStatus | undefined) ?? "revoked" };
    },

    async createSession(params) {
      const payload = await request("/api/v3.1/sessions", {
        method: "POST",
        body: JSON.stringify({
          external_user_id: params.principalId,
          purpose: params.purpose,
          toolkits: params.toolkitSlugs,
          connected_account_ids: params.connectedAccountIds
        })
      });

      return {
        id: String(payload.id ?? payload.session_id),
        status: (payload.status as ComposioSession["status"] | undefined) ?? "active",
        principalId: params.principalId,
        purpose: params.purpose,
        toolkitSlugs: params.toolkitSlugs,
        connectedAccountIds: params.connectedAccountIds
      };
    },

    async discoverToolkitActions(params) {
      const search = new URLSearchParams();
      for (const toolkit of params.toolkitSlugs) {
        search.append("toolkits", toolkit);
      }
      const payload = await request(`/api/v3.1/tools?${search.toString()}`);

      return arrayFromPayload(payload).map((item) => ({
        id: String(item.id ?? item.slug ?? item.name),
        toolkitSlug: String(item.toolkit_slug ?? item.toolkit ?? params.toolkitSlugs[0]),
        slug: normalizeSlug(String(item.slug ?? item.name ?? item.id)),
        name: String(item.name ?? item.slug ?? item.id),
        description: String(item.description ?? "Composio tool action."),
        inputSchema: (item.input_schema as Record<string, unknown> | undefined) ?? {}
      }));
    }
  };
}

export function createComposioControlPlane(options: ControlPlaneOptions = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? createId;

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ComposioState) {
    await store.write(state);
    return state;
  }

  function apiClient(config?: ConfigureComposioInput | ComposioConfig) {
    const apiKey = config && "apiKey" in config ? config.apiKey : undefined;
    return options.apiClient ?? createComposioRestClient({ apiKey, baseUrl: config?.baseUrl });
  }

  function appendEvent(state: ComposioState, action: ComposioAuditEvent["action"], targetId: string, metadata: Record<string, unknown>) {
    state.auditEvents.unshift({
      id: id("evt_composio"),
      action,
      targetId,
      metadata,
      createdAt: now()
    });
  }

  function ensureConfigured(state: ComposioState) {
    if (!state.config?.apiKeyConfigured) {
      throw new Error("Composio API key is required before this operation.");
    }
  }

  return {
    async getState() {
      return load();
    },

    async configure(input: ConfigureComposioInput) {
      const baseUrl = input.baseUrl ?? process.env.COMPOSIO_BASE_URL ?? defaultBaseUrl;
      const apiKeyConfigured = Boolean(input.apiKeyConfigured || input.apiKey || process.env.COMPOSIO_API_KEY);

      if (!apiKeyConfigured) {
        throw new Error("Composio API key is required.");
      }

      const validation = await apiClient({ ...input, baseUrl }).validateConfiguration({
        projectId: input.projectId,
        baseUrl,
        apiKey: input.apiKey
      });

      if (!validation.ok) {
        throw new Error("Composio configuration validation failed.");
      }

      const state = await load();
      const timestamp = now();
      state.config = {
        projectId: input.projectId,
        baseUrl,
        apiKeyConfigured: true,
        apiKeyRef: input.apiKey ? "request" : "COMPOSIO_API_KEY",
        authConfigCount: validation.authConfigs?.length ?? 0,
        validatedAt: timestamp,
        updatedAt: timestamp
      };
      appendEvent(state, "composio.config.validated", input.projectId, {
        authConfigCount: state.config.authConfigCount
      });

      await save(state);
      return state.config;
    },

    async initiateConnectedAccount(input: { toolkitSlug: string; authConfigId: string; principalId: string }) {
      const state = await load();
      ensureConfigured(state);
      const response = await apiClient(state.config ?? undefined).createConnectedAccountLink(input);
      const timestamp = now();
      const account: ComposioConnectedAccount = {
        id: response.connectedAccountId || id("acct_composio"),
        toolkitSlug: input.toolkitSlug,
        authConfigId: input.authConfigId,
        principalId: input.principalId,
        externalUserId: response.externalUserId,
        status: response.status ?? "pending",
        connectUrl: response.connectUrl,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.connectedAccounts = [account, ...state.connectedAccounts.filter((candidate) => candidate.id !== account.id)];
      appendEvent(state, "composio.account.initiated", account.id, {
        toolkitSlug: account.toolkitSlug,
        authConfigId: account.authConfigId
      });
      await save(state);
      return { ...account };
    },

    async testConnectedAccount(accountId: string) {
      const state = await load();
      ensureConfigured(state);
      const account = requireAccount(state, accountId);
      const result = await apiClient(state.config ?? undefined).testConnectedAccount(accountId);
      account.status = result.status ?? (result.ok ? "active" : "errored");
      account.lastTestedAt = now();
      account.updatedAt = account.lastTestedAt;
      appendEvent(state, "composio.account.tested", account.id, {
        ok: result.ok,
        status: account.status
      });
      await save(state);
      return { ...account };
    },

    async refreshConnectedAccount(accountId: string) {
      const state = await load();
      ensureConfigured(state);
      const account = requireAccount(state, accountId);
      const result = await apiClient(state.config ?? undefined).refreshConnectedAccount(accountId);
      account.status = result.status ?? "active";
      account.lastRefreshedAt = now();
      account.updatedAt = account.lastRefreshedAt;
      appendEvent(state, "composio.account.refreshed", account.id, { status: account.status });
      await save(state);
      return { ...account };
    },

    async revokeConnectedAccount(accountId: string) {
      const state = await load();
      ensureConfigured(state);
      const account = requireAccount(state, accountId);
      const result = await apiClient(state.config ?? undefined).revokeConnectedAccount(accountId);
      account.status = result.status ?? "revoked";
      account.revokedAt = now();
      account.updatedAt = account.revokedAt;
      appendEvent(state, "composio.account.revoked", account.id, { status: account.status });
      await save(state);
      return { ...account };
    },

    async reauthorizeConnectedAccount(accountId: string) {
      const state = await load();
      ensureConfigured(state);
      const account = requireAccount(state, accountId);
      const response = await apiClient(state.config ?? undefined).createConnectedAccountLink({
        toolkitSlug: account.toolkitSlug,
        authConfigId: account.authConfigId,
        principalId: account.principalId
      });
      account.status = "pending";
      account.connectUrl = response.connectUrl ?? account.connectUrl;
      account.revokedAt = undefined;
      account.updatedAt = now();
      appendEvent(state, "composio.account.reauthorized", account.id, {
        toolkitSlug: account.toolkitSlug
      });
      await save(state);
      return { ...account };
    },

    async getOrCreateSession(input: {
      principalId: string;
      purpose: ComposioSessionPurpose;
      toolkitSlugs: string[];
      connectedAccountIds: string[];
    }) {
      const state = await load();
      ensureConfigured(state);
      const accounts = input.connectedAccountIds.map((accountId) => requireAccount(state, accountId));
      const revoked = accounts.find((account) => account.status === "revoked");
      if (revoked) {
        throw new Error(`Connected account ${revoked.id} is revoked and cannot be used for a session.`);
      }

      const existing = state.sessions.find(
        (session) =>
          session.status === "active" &&
          session.principalId === input.principalId &&
          session.purpose === input.purpose &&
          sameSet(session.toolkitSlugs, input.toolkitSlugs) &&
          sameSet(session.connectedAccountIds, input.connectedAccountIds)
      );

      if (existing) {
        existing.reusedAt = now();
        appendEvent(state, "composio.session.reused", existing.id, { purpose: existing.purpose });
        await save(state);
        return { ...existing, toolkitSlugs: [...existing.toolkitSlugs], connectedAccountIds: [...existing.connectedAccountIds] };
      }

      const created = await apiClient(state.config ?? undefined).createSession(input);
      const session: ComposioSession = {
        id: created.id,
        principalId: created.principalId ?? input.principalId,
        purpose: created.purpose ?? input.purpose,
        toolkitSlugs: created.toolkitSlugs ?? input.toolkitSlugs,
        connectedAccountIds: created.connectedAccountIds ?? input.connectedAccountIds,
        status: created.status ?? "active",
        createdAt: now()
      };
      state.sessions.unshift(session);
      appendEvent(state, "composio.session.created", session.id, {
        purpose: session.purpose,
        toolkitSlugs: session.toolkitSlugs
      });
      await save(state);
      return { ...session, toolkitSlugs: [...session.toolkitSlugs], connectedAccountIds: [...session.connectedAccountIds] };
    },

    async discoverToolkitActions(input: { toolkitSlugs: string[]; ownerId: string; tier: BrainTier }) {
      const state = await load();
      ensureConfigured(state);
      const actions = await apiClient(state.config ?? undefined).discoverToolkitActions({ toolkitSlugs: input.toolkitSlugs });

      if (actions.length === 0) {
        throw new Error(`No Composio actions were available for ${input.toolkitSlugs.join(", ")}.`);
      }

      const timestamp = now();
      const registryCandidates = actions.map<ToolDefinition>((action) => ({
        id: `tool_composio_${normalizeSlug(action.toolkitSlug)}_${normalizeSlug(action.slug)}`,
        tenantId: defaultTenantId,
        kind: "tool",
        name: `Composio ${action.name}`,
        slug: `composio-${normalizeSlug(action.toolkitSlug)}-${normalizeSlug(action.slug)}`,
        description: action.description,
        tier: input.tier,
        ownerId: input.ownerId,
        version: "0.1.0",
        status: "review",
        permissions: [`composio:${action.toolkitSlug}:execute`],
        dependencies: [],
        requiredTools: [],
        adapterTargets: ["codex", "claude-code", "opencode", "generic-mcp"],
        updatedAt: timestamp,
        toolType: "connector",
        inputSchema: action.inputSchema,
        rateLimit: "60/minute/connected-account",
        secrets: ["COMPOSIO_API_KEY"],
        auditPolicy: "log-metadata"
      }));
      const candidateIds = new Set(registryCandidates.map((candidate) => candidate.id));
      state.registryCandidates = [
        ...registryCandidates,
        ...state.registryCandidates.filter((candidate) => !candidateIds.has(candidate.id))
      ];
      appendEvent(state, "composio.toolkits.discovered", input.toolkitSlugs.join(","), {
        actionCount: actions.length,
        candidateCount: registryCandidates.length
      });
      await save(state);
      return { actions, registryCandidates };
    }
  };
}

export const composioControlPlane = createComposioControlPlane();
