import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canInvokeRegistryItem } from "./policy";
import { composioControlPlane, type ComposioSessionPurpose, type ComposioState } from "./composio-control-plane";
import type { BrainEvent, Principal, ToolDefinition } from "./types";

export type ToolInvocationStatus = "succeeded" | "denied" | "failed" | "needs-approval";

export type ToolInvocationRecord = {
  id: string;
  status: ToolInvocationStatus;
  toolId: string;
  toolSlug: string;
  principalId: string;
  connectedAccountId: string;
  sessionId?: string;
  packageVersion: string;
  requestMetadata: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
  decision: {
    allowed: boolean;
    reasons: string[];
  };
  createdAt: string;
};

export type ToolInvocationState = {
  records: ToolInvocationRecord[];
  auditEvents: BrainEvent[];
};

export type ToolInvocationStore = {
  read(): Promise<ToolInvocationState | null>;
  write(state: ToolInvocationState): Promise<void>;
};

export type ToolExecutorInput = {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  sessionId: string;
  connectedAccountId: string;
};

type GatewayOptions = {
  store?: ToolInvocationStore;
  controlPlane?: { getState(): Promise<ComposioState> };
  executor?: (input: ToolExecutorInput) => Promise<Record<string, unknown>>;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type InvokeInput = {
  principal: Principal;
  tool: ToolDefinition;
  connectedAccountId: string;
  sessionPurpose: ComposioSessionPurpose;
  packageVersion: string;
  args: Record<string, unknown>;
  budgetUsd: number;
  requiresApproval?: boolean;
};

function defaultStatePath() {
  return process.env.TOOL_INVOCATION_STATE_PATH ?? join(process.cwd(), "data", "tool-invocation-state.json");
}

function createFileStore(path = defaultStatePath()): ToolInvocationStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ToolInvocationState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): ToolInvocationState {
  return {
    records: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        /(secret|token|password|api.?key|authorization|credential)/i.test(key) ? "[redacted]" : redact(nested)
      ])
    );
  }
  if (typeof value === "string" && /(secret|token|password|sk-|bearer\s+)/i.test(value)) {
    return "[redacted]";
  }
  return value;
}

function parseRateLimit(limit: string) {
  const match = limit.match(/^(\d+)/);
  return match ? Number(match[1]) : 60;
}

function auditEvent(input: {
  id: string;
  tenantId: string;
  actorId: string;
  record: ToolInvocationRecord;
  policyDecision: BrainEvent["policyDecision"];
  createdAt: string;
}): BrainEvent {
  return {
    id: input.id,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "tool.invoke",
    targetId: input.record.toolId,
    targetType: "tool",
    policyDecision: input.policyDecision,
    metadata: {
      invocationId: input.record.id,
      status: input.record.status,
      connectedAccountId: input.record.connectedAccountId,
      sessionId: input.record.sessionId,
      decision: input.record.decision.reasons
    },
    createdAt: input.createdAt
  };
}

function createRecord(input: {
  id: string;
  status: ToolInvocationStatus;
  tool: ToolDefinition;
  principal: Principal;
  connectedAccountId: string;
  sessionId?: string;
  packageVersion: string;
  args: Record<string, unknown>;
  response?: Record<string, unknown>;
  decision: { allowed: boolean; reasons: string[] };
  createdAt: string;
}): ToolInvocationRecord {
  return {
    id: input.id,
    status: input.status,
    toolId: input.tool.id,
    toolSlug: input.tool.slug,
    principalId: input.principal.id,
    connectedAccountId: input.connectedAccountId,
    sessionId: input.sessionId,
    packageVersion: input.packageVersion,
    requestMetadata: redact(input.args) as Record<string, unknown>,
    responseMetadata: input.response ? (redact(input.response) as Record<string, unknown>) : undefined,
    decision: input.decision,
    createdAt: input.createdAt
  };
}

export function createToolInvocationGateway(options: GatewayOptions = {}) {
  const store = options.store ?? createFileStore();
  const controlPlane = options.controlPlane ?? composioControlPlane;
  const executor = options.executor ?? (async () => ({ ok: true, simulated: true }));
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ToolInvocationState) {
    await store.write(state);
  }

  function rateLimited(state: ToolInvocationState, input: InvokeInput, timestamp: string) {
    const limit = parseRateLimit(input.tool.rateLimit);
    const windowStart = Date.parse(timestamp) - 60_000;
    const recent = state.records.filter(
      (record) =>
        record.toolId === input.tool.id &&
        record.connectedAccountId === input.connectedAccountId &&
        record.status === "succeeded" &&
        Date.parse(record.createdAt) >= windowStart
    );
    return recent.length >= limit;
  }

  async function persist(state: ToolInvocationState, record: ToolInvocationRecord, policyDecision: BrainEvent["policyDecision"]) {
    const event = auditEvent({
      id: id("evt_tool_invoke"),
      tenantId,
      actorId: record.principalId,
      record,
      policyDecision,
      createdAt: record.createdAt
    });
    state.records = [record, ...state.records];
    state.auditEvents = [event, ...state.auditEvents];
    await save(state);
    return event;
  }

  return {
    async getState() {
      return load();
    },

    async invoke(input: InvokeInput) {
      const state = await load();
      const timestamp = now();
      const control = await controlPlane.getState();
      const account = control.connectedAccounts.find((candidate) => candidate.id === input.connectedAccountId);
      const session = control.sessions.find(
        (candidate) =>
          candidate.status === "active" &&
          candidate.principalId === input.principal.id &&
          candidate.purpose === input.sessionPurpose &&
          candidate.connectedAccountIds.includes(input.connectedAccountId)
      );
      const policy = canInvokeRegistryItem(input.principal, input.tool);
      const reasons: string[] = [];
      if (!policy.allowed) {
        reasons.push(policy.reason);
      }
      if (!input.principal.scopes.includes("tool:invoke") && !input.principal.scopes.includes("cron:run")) {
        reasons.push("Principal lacks tool invocation scope.");
      }
      if (input.packageVersion !== input.tool.version) {
        reasons.push(`Package version ${input.packageVersion} does not match published ${input.tool.version}.`);
      }
      if (!account) {
        reasons.push(`Connected account ${input.connectedAccountId} was not found.`);
      } else if (account.status !== "active") {
        reasons.push(`Connected account ${input.connectedAccountId} is ${account.status}.`);
      }
      if (!session) {
        reasons.push("No active Composio session matches principal, purpose, and connected account.");
      }
      if (input.budgetUsd <= 0) {
        reasons.push("Budget must be positive.");
      }
      if (rateLimited(state, input, timestamp)) {
        reasons.push("Rate limit exceeded for connected account.");
      }
      if (input.requiresApproval) {
        const record = createRecord({
          id: id("tool_invocation"),
          status: "needs-approval",
          tool: input.tool,
          principal: input.principal,
          connectedAccountId: input.connectedAccountId,
          sessionId: session?.id,
          packageVersion: input.packageVersion,
          args: input.args,
          decision: { allowed: false, reasons: ["Approval required before execution."] },
          createdAt: timestamp
        });
        const event = await persist(state, record, "needs-approval");
        return { status: record.status, decision: record.decision, record, auditEvent: event };
      }
      if (reasons.length > 0 || !session) {
        const record = createRecord({
          id: id("tool_invocation"),
          status: "denied",
          tool: input.tool,
          principal: input.principal,
          connectedAccountId: input.connectedAccountId,
          sessionId: session?.id,
          packageVersion: input.packageVersion,
          args: input.args,
          decision: { allowed: false, reasons },
          createdAt: timestamp
        });
        const event = await persist(state, record, "deny");
        return { status: record.status, decision: record.decision, record, auditEvent: event };
      }

      try {
        const response = await executor({
          tool: input.tool,
          args: input.args,
          sessionId: session.id,
          connectedAccountId: input.connectedAccountId
        });
        const record = createRecord({
          id: id("tool_invocation"),
          status: "succeeded",
          tool: input.tool,
          principal: input.principal,
          connectedAccountId: input.connectedAccountId,
          sessionId: session.id,
          packageVersion: input.packageVersion,
          args: input.args,
          response,
          decision: { allowed: true, reasons: ["Allowed by policy, account, session, rate, and budget checks."] },
          createdAt: timestamp
        });
        const event = await persist(state, record, "allow");
        return { status: record.status, decision: record.decision, record, auditEvent: event };
      } catch (error) {
        const record = createRecord({
          id: id("tool_invocation"),
          status: "failed",
          tool: input.tool,
          principal: input.principal,
          connectedAccountId: input.connectedAccountId,
          sessionId: session.id,
          packageVersion: input.packageVersion,
          args: input.args,
          response: { error: error instanceof Error ? error.message : "Tool execution failed." },
          decision: { allowed: true, reasons: ["Execution failed after policy approval."] },
          createdAt: timestamp
        });
        const event = await persist(state, record, "allow");
        return { status: record.status, decision: record.decision, record, auditEvent: event };
      }
    }
  };
}

export const toolInvocationGateway = createToolInvocationGateway();
