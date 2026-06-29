import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createToolInvocationGateway, type ToolInvocationState, type ToolInvocationStore } from "../lib/tool-invocation-gateway";
import type { ComposioState } from "../lib/composio-control-plane";
import type { Principal, ToolDefinition } from "../lib/types";

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "tool:invoke"]
};

const employee: Principal = {
  ...reviewer,
  id: "usr_employee",
  role: "employee",
  scopes: ["brain:read"]
};

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tool_slack_read",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Slack read",
    slug: "slack-read",
    description: "Read Slack through Composio.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["composio:slack:execute"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    toolType: "connector",
    inputSchema: {},
    rateLimit: "1/minute/connected-account",
    secrets: ["SLACK_TOKEN"],
    auditPolicy: "log-metadata",
    ...overrides
  };
}

function control(status: "active" | "revoked" = "active"): ComposioState {
  return {
    config: null,
    connectedAccounts: [
      {
        id: "acct_slack",
        toolkitSlug: "slack",
        authConfigId: "auth_slack",
        principalId: "usr_reviewer",
        status,
        createdAt: "2026-06-29T10:00:00.000Z",
        updatedAt: "2026-06-29T10:00:00.000Z"
      }
    ],
    sessions: [
      {
        id: "sess_slack",
        principalId: "usr_reviewer",
        purpose: "interactive-agent",
        toolkitSlugs: ["slack"],
        connectedAccountIds: ["acct_slack"],
        status: "active",
        createdAt: "2026-06-29T10:00:00.000Z"
      }
    ],
    registryCandidates: [],
    auditEvents: []
  };
}

function createStore() {
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

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("tool invocation gateway", () => {
  it("executes allowed Composio actions through active session and stores sanitized metadata", async () => {
    const executor = vi.fn(async () => ({ ok: true, data: { message: "done", token: "secret-response" } }));
    const gateway = createToolInvocationGateway({
      store: createStore(),
      controlPlane: { getState: async () => control() },
      executor,
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const result = await gateway.invoke({
      principal: reviewer,
      tool: tool(),
      connectedAccountId: "acct_slack",
      sessionPurpose: "interactive-agent",
      packageVersion: "1.0.0",
      args: { channel: "C123", apiKey: "secret-input" },
      budgetUsd: 1
    });

    expect(result.status).toBe("succeeded");
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess_slack", connectedAccountId: "acct_slack" }));
    expect(JSON.stringify(result.record)).not.toContain("secret-input");
    expect(JSON.stringify(result.record)).not.toContain("secret-response");
  });

  it("denies forbidden write actions before execution", async () => {
    const executor = vi.fn();
    const gateway = createToolInvocationGateway({
      store: createStore(),
      controlPlane: { getState: async () => control() },
      executor
    });

    const result = await gateway.invoke({
      principal: employee,
      tool: tool({ permissions: ["composio:slack:write"] }),
      connectedAccountId: "acct_slack",
      sessionPurpose: "interactive-agent",
      packageVersion: "1.0.0",
      args: {},
      budgetUsd: 1
    });

    expect(result.status).toBe("denied");
    expect(executor).not.toHaveBeenCalled();
  });

  it("blocks revoked connected accounts", async () => {
    const gateway = createToolInvocationGateway({
      store: createStore(),
      controlPlane: { getState: async () => control("revoked") },
      executor: async () => ({ ok: true })
    });

    const result = await gateway.invoke({
      principal: reviewer,
      tool: tool(),
      connectedAccountId: "acct_slack",
      sessionPurpose: "interactive-agent",
      packageVersion: "1.0.0",
      args: {},
      budgetUsd: 1
    });

    expect(result.status).toBe("denied");
    expect(result.decision.reasons.join(" ")).toMatch(/revoked/i);
  });

  it("enforces simple connected-account rate limits", async () => {
    const gateway = createToolInvocationGateway({
      store: createStore(),
      controlPlane: { getState: async () => control() },
      executor: async () => ({ ok: true }),
      now: () => "2026-06-29T10:00:00.000Z"
    });
    const input = {
      principal: reviewer,
      tool: tool(),
      connectedAccountId: "acct_slack",
      sessionPurpose: "interactive-agent" as const,
      packageVersion: "1.0.0",
      args: {},
      budgetUsd: 1
    };

    expect((await gateway.invoke(input)).status).toBe("succeeded");
    expect((await gateway.invoke(input)).status).toBe("denied");
  });

  it("returns needs-approval without execution when approval gates require it", async () => {
    const executor = vi.fn();
    const gateway = createToolInvocationGateway({
      store: createStore(),
      controlPlane: { getState: async () => control() },
      executor
    });

    const result = await gateway.invoke({
      principal: reviewer,
      tool: tool(),
      connectedAccountId: "acct_slack",
      sessionPurpose: "interactive-agent",
      packageVersion: "1.0.0",
      args: {},
      budgetUsd: 1,
      requiresApproval: true
    });

    expect(result.status).toBe("needs-approval");
    expect(executor).not.toHaveBeenCalled();
  });

  it("invokes through API route with redaction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-tool-invoke-"));
    process.env.TOOL_INVOCATION_STATE_PATH = join(dir, "tool-invocations.json");
    process.env.COMPOSIO_STATE_PATH = join(dir, "composio.json");
    vi.resetModules();
    const route = await import("../app/api/v1/tools/invoke/route");

    const response = await route.POST(
      jsonRequest("/api/v1/tools/invoke", {
        principal: reviewer,
        tool: tool(),
        controlState: control(),
        connectedAccountId: "acct_slack",
        sessionPurpose: "interactive-agent",
        packageVersion: "1.0.0",
        args: { password: "secret-input" },
        budgetUsd: 1
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("succeeded");
    expect(JSON.stringify(payload)).not.toContain("secret-input");
  });
});
