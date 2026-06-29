import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCronOutputDelivery, type CronOutputDeliveryInput, type CronOutputDeliveryState, type CronOutputDeliveryStore } from "../lib/cron-output-delivery";
import type { Principal, ToolDefinition } from "../lib/types";

const principal: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["cron:run", "tool:invoke"]
};

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tool_slack_send",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Slack Send",
    slug: "slack-send",
    description: "Send Slack notifications through Composio.",
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
    rateLimit: "60/minute",
    secrets: ["SLACK_TOKEN"],
    auditPolicy: "log-metadata",
    ...overrides
  };
}

function createStore() {
  let state: CronOutputDeliveryState | null = null;
  const store: CronOutputDeliveryStore & { snapshot: () => CronOutputDeliveryState | null } = {
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

function baseInput(overrides: Partial<CronOutputDeliveryInput> = {}): CronOutputDeliveryInput {
  return {
    principal,
    cronJobId: "cron_weekly",
    runId: "run_weekly",
    output: "Weekly brain health is green.",
    allowedTools: ["tool_slack_send"],
    budgetUsd: 2,
    destinations: [
      {
        id: "dest_slack",
        type: "slack",
        uri: "slack://platform/brain-health",
        toolId: "tool_slack_send",
        connectedAccountId: "acct_slack",
        quietWindowMinutes: 30
      }
    ],
    dedupeKey: "weekly:brain-health",
    ...overrides
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("cron output delivery", () => {
  it("delivers approved Slack output through the tool invocation gateway", async () => {
    const gateway = { invoke: vi.fn(async () => ({ status: "succeeded", record: { id: "tool_invocation_1" } })) };
    const service = createCronOutputDelivery({
      store: createStore(),
      registryItems: [tool()],
      toolGateway: gateway,
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const result = await service.deliver(baseInput());

    expect(gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ id: "tool_slack_send" }), sessionPurpose: "cron-job" }));
    expect(result.deliveries[0]).toMatchObject({ status: "delivered", destinationLink: "slack://platform/brain-health" });
    expect(result.deliveries[0]?.toolInvocationId).toBe("tool_invocation_1");
  });

  it("pauses sensitive output for approval with reviewer context", async () => {
    const gateway = { invoke: vi.fn() };
    const service = createCronOutputDelivery({ store: createStore(), registryItems: [tool()], toolGateway: gateway });

    const result = await service.deliver(
      baseInput({
        output: "Restricted customer revenue and secret token details.",
        sensitive: true
      })
    );

    expect(result.deliveries[0]?.status).toBe("needs-approval");
    expect(result.approvals[0]).toMatchObject({ runId: "run_weekly", reviewerContext: expect.stringMatching(/Restricted customer revenue/i) });
    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it("blocks delivery when destination tools are not allowed", async () => {
    const service = createCronOutputDelivery({ store: createStore(), registryItems: [tool()] });

    const result = await service.deliver(baseInput({ allowedTools: [] }));

    expect(result.deliveries[0]).toMatchObject({ status: "blocked" });
    expect(result.deliveries[0]?.reason).toMatch(/not allowed/i);
  });

  it("records failed webhook delivery and audit metadata", async () => {
    const service = createCronOutputDelivery({
      store: createStore(),
      registryItems: [tool()],
      webhookClient: { post: vi.fn(async () => { throw new Error("webhook down"); }) }
    });

    const result = await service.deliver(
      baseInput({
        allowedTools: [],
        destinations: [{ id: "dest_webhook", type: "webhook", uri: "https://example.com/hook" }]
      })
    );

    expect(result.deliveries[0]).toMatchObject({ status: "failed", reason: "webhook down" });
    expect(result.auditEvents[0]).toMatchObject({ action: "cron.run", policyDecision: "deny" });
  });

  it("blocks revoked or denied Composio delivery responses", async () => {
    const service = createCronOutputDelivery({
      store: createStore(),
      registryItems: [tool()],
      toolGateway: { invoke: vi.fn(async () => ({ status: "denied", record: { id: "tool_invocation_denied" }, decision: { reasons: ["Connected account acct_slack is revoked."] } })) }
    });

    const result = await service.deliver(baseInput());

    expect(result.deliveries[0]).toMatchObject({ status: "blocked", toolInvocationId: "tool_invocation_denied" });
    expect(result.deliveries[0]?.reason).toMatch(/denied|revoked/i);
  });

  it("suppresses duplicate notifications inside the quiet window", async () => {
    const gateway = { invoke: vi.fn(async () => ({ status: "succeeded", record: { id: "tool_invocation_1" } })) };
    const service = createCronOutputDelivery({
      store: createStore(),
      registryItems: [tool()],
      toolGateway: gateway,
      now: () => "2026-06-29T10:00:00.000Z"
    });

    expect((await service.deliver(baseInput())).deliveries[0]?.status).toBe("delivered");
    expect((await service.deliver(baseInput({ runId: "run_weekly_2" }))).deliveries[0]?.status).toBe("suppressed");
    expect(gateway.invoke).toHaveBeenCalledTimes(1);
  });

  it("delivers through API route and exposes status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-cron-output-"));
    process.env.CRON_OUTPUT_DELIVERY_STATE_PATH = join(dir, "outputs.json");
    vi.resetModules();
    const deliverRoute = await import("../app/api/v1/cron-output/deliver/route");
    const statusRoute = await import("../app/api/v1/cron-output/status/route");

    const response = await deliverRoute.POST(
      jsonRequest("/api/v1/cron-output/deliver", {
        ...baseInput({
          allowedTools: [],
          destinations: [{ id: "dest_dashboard", type: "dashboard", uri: "dashboard://brain-health" }]
        }),
        registryItems: [tool()]
      })
    );
    const payload = await response.json();
    const status = await statusRoute.GET();
    const state = await status.json();

    expect(response.status).toBe(200);
    expect(payload.deliveries[0].status).toBe("delivered");
    expect(state.dashboardOutputs).toHaveLength(1);
  });
});
