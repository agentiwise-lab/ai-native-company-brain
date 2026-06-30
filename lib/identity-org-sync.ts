import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrainEvent, BrainTier, Principal, RegistryItem } from "./types";

export type SamlConfig = {
  entityId: string;
  ssoUrl: string;
  certificateFingerprint: string;
};

export type ScimConfig = {
  baseUrl: string;
  tokenConfigured: boolean;
};

export type IdentityConfig = {
  saml: SamlConfig;
  scim: ScimConfig;
  updatedAt: string;
  updatedBy: string;
};

export type IdentityUser = {
  id: string;
  externalId: string;
  email: string;
  name: string;
  active: boolean;
  groupIds: string[];
  updatedAt: string;
};

export type IdentityGroup = {
  id: string;
  displayName: string;
  teams: string[];
  tiers: BrainTier[];
  role: Principal["role"];
  scopes: string[];
  reviewerForTiers: BrainTier[];
  updatedAt: string;
};

export type AccessRevocation = {
  id: string;
  userId: string;
  reason: string;
  surfaces: Array<"ui" | "api" | "mcp" | "composio">;
  createdAt: string;
};

export type IdentityOrgState = {
  config: IdentityConfig | null;
  users: IdentityUser[];
  groups: IdentityGroup[];
  processedScimEventIds: string[];
  revocations: AccessRevocation[];
  auditEvents: BrainEvent[];
};

export type IdentityOrgStore = {
  read(): Promise<IdentityOrgState | null>;
  write(state: IdentityOrgState): Promise<void>;
};

type ScimGroupInput = Omit<IdentityGroup, "updatedAt">;
type ScimUserInput = Omit<IdentityUser, "updatedAt">;

export type ScimEvent =
  | { id: string; type: "group.upsert"; group: ScimGroupInput }
  | { id: string; type: "user.upsert"; user: ScimUserInput }
  | { id: string; type: "user.deactivate"; userId: string };

type ConfigureInput = {
  principal: Principal;
  saml: SamlConfig;
  scim: ScimConfig;
};

type SyncInput = {
  principal: Principal;
  events: ScimEvent[];
};

type Options = {
  store?: IdentityOrgStore;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

const roleRank: Record<Principal["role"], number> = {
  employee: 1,
  agent: 1,
  operator: 2,
  reviewer: 3,
  admin: 4
};

function defaultStatePath() {
  return process.env.IDENTITY_ORG_STATE_PATH ?? join(process.cwd(), "data", "identity-org-state.json");
}

function createFileStore(path = defaultStatePath()): IdentityOrgStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as IdentityOrgState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): IdentityOrgState {
  return {
    config: null,
    users: [],
    groups: [],
    processedScimEventIds: [],
    revocations: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function requireAdmin(principal: Principal) {
  if (principal.role !== "admin") {
    throw new Error("Identity configuration and SCIM sync require an admin.");
  }
}

export function createIdentityOrgSync(options: Options = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: IdentityOrgState) {
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
      id: id("evt_identity"),
      tenantId,
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      targetType: input.targetType,
      policyDecision: input.policyDecision,
      metadata: input.metadata,
      createdAt: input.createdAt
    };
  }

  function groupsForUser(state: IdentityOrgState, user: IdentityUser) {
    const groupMap = new Map(state.groups.map((group) => [group.id, group]));
    return user.groupIds.flatMap((groupId) => {
      const group = groupMap.get(groupId);
      return group ? [group] : [];
    });
  }

  function derivePrincipal(state: IdentityOrgState, user: IdentityUser): Principal {
    if (!user.active) {
      throw new Error(`User ${user.id} is deactivated by SCIM.`);
    }
    const groups = groupsForUser(state, user);
    const role = groups.map((group) => group.role).sort((left, right) => roleRank[right] - roleRank[left])[0] ?? "employee";
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      teams: unique(groups.flatMap((group) => group.teams)),
      tiers: unique(groups.flatMap((group) => group.tiers)),
      scopes: unique(groups.flatMap((group) => group.scopes))
    };
  }

  async function accessDecision(userId: string, surface: "ui" | "api" | "mcp" | "composio") {
    const state = await load();
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      return { allowed: false, reasons: [`User ${userId} was not found.`] };
    }
    if (!user.active) {
      return { allowed: false, reasons: [`User ${userId} is deactivated by SCIM and cannot access ${surface}.`] };
    }
    return { allowed: true, reasons: [`User ${userId} is active for ${surface}.`] };
  }

  return {
    async getState() {
      return load();
    },

    async configure(input: ConfigureInput) {
      requireAdmin(input.principal);
      const state = await load();
      const timestamp = now();
      state.config = {
        saml: input.saml,
        scim: input.scim,
        updatedAt: timestamp,
        updatedBy: input.principal.id
      };
      state.auditEvents = [
        audit({
          actorId: input.principal.id,
          action: "identity.configure",
          targetId: "identity",
          targetType: "identity",
          policyDecision: "allow",
          metadata: { samlEntityId: input.saml.entityId, scimBaseUrl: input.scim.baseUrl, tokenConfigured: input.scim.tokenConfigured },
          createdAt: timestamp
        }),
        ...state.auditEvents
      ];
      await save(state);
      return state;
    },

    async syncScim(input: SyncInput) {
      requireAdmin(input.principal);
      const state = await load();
      const timestamp = now();
      let appliedEvents = 0;
      let duplicatesSuppressed = 0;
      const appliedIds: string[] = [];
      const emittedEvents: BrainEvent[] = [];

      for (const event of input.events) {
        if (state.processedScimEventIds.includes(event.id)) {
          duplicatesSuppressed += 1;
          continue;
        }
        appliedEvents += 1;
        appliedIds.push(event.id);
        state.processedScimEventIds.unshift(event.id);

        if (event.type === "group.upsert") {
          const group: IdentityGroup = { ...event.group, updatedAt: timestamp };
          state.groups = [...state.groups.filter((candidate) => candidate.id !== group.id), group];
        }

        if (event.type === "user.upsert") {
          const user: IdentityUser = { ...event.user, updatedAt: timestamp };
          state.users = [...state.users.filter((candidate) => candidate.id !== user.id), user];
        }

        if (event.type === "user.deactivate") {
          const user = state.users.find((candidate) => candidate.id === event.userId);
          if (user) {
            user.active = false;
            user.updatedAt = timestamp;
          }
          const revocation: AccessRevocation = {
            id: id("identity_revocation"),
            userId: event.userId,
            reason: "SCIM deactivation",
            surfaces: ["ui", "api", "mcp", "composio"],
            createdAt: timestamp
          };
          state.revocations = [revocation, ...state.revocations.filter((candidate) => candidate.userId !== event.userId)];
          emittedEvents.push(
            audit({
              actorId: input.principal.id,
              action: "access.revoke",
              targetId: event.userId,
              targetType: "principal",
              policyDecision: "allow",
              metadata: { surfaces: revocation.surfaces, reason: revocation.reason },
              createdAt: timestamp
            })
          );
        }
      }

      if (appliedEvents > 0) {
        emittedEvents.unshift(
          audit({
            actorId: input.principal.id,
            action: "identity.scim.sync",
            targetId: "scim",
            targetType: "identity",
            policyDecision: "allow",
            metadata: { appliedEvents, eventIds: appliedIds },
            createdAt: timestamp
          })
        );
      }

      state.auditEvents = [...emittedEvents, ...state.auditEvents];
      await save(state);
      return { state, appliedEvents, duplicatesSuppressed, auditEvents: emittedEvents };
    },

    async principalForUser(userId: string) {
      const state = await load();
      const user = state.users.find((candidate) => candidate.id === userId);
      if (!user) {
        throw new Error(`User ${userId} was not found.`);
      }
      return derivePrincipal(state, user);
    },

    accessDecision,

    async canUseComposioSession(principalId: string, sessionId?: string, connectedAccountId?: string) {
      const decision = await accessDecision(principalId, "composio");
      if (!decision.allowed) {
        return {
          allowed: false,
          reasons: [...decision.reasons, `Session ${sessionId ?? "unknown"} and account ${connectedAccountId ?? "unknown"} are stale.`]
        };
      }
      return decision;
    },

    async reviewerForTier(tier: BrainTier) {
      const state = await load();
      for (const user of state.users) {
        if (!user.active) {
          continue;
        }
        const groups = groupsForUser(state, user);
        if (groups.some((group) => group.reviewerForTiers.includes(tier))) {
          return derivePrincipal(state, user);
        }
      }
      return null;
    },

    visibleRegistryItems(principal: Principal, items: RegistryItem[]) {
      const canReadRegistry = principal.scopes.some((scope) => scope === "registry:read" || scope === "registry:review" || scope === "registry:publish");
      if (!canReadRegistry) {
        return [];
      }
      return items.filter((item) => principal.tiers.includes(item.tier));
    }
  };
}

export const identityOrgSync = createIdentityOrgSync();
