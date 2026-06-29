import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDurableScheduler, type DurableSchedulerState, type DurableSchedulerStore } from "../lib/durable-scheduler";
import type { Principal, ToolDefinition } from "../lib/types";

const principal: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["cron:run", "tool:invoke", "registry:read"]
};

function tool(): ToolDefinition {
  return {
    id: "tool_brain_query",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Brain Query",
    slug: "brain-query",
    description: "Query governed memory.",
    tier: "team",
    ownerId: "usr_admin",
    version: "1.0.0",
    status: "published",
    permissions: ["brain:read"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["generic-mcp"],
    updatedAt: "2026-06-29T10:00:00.000Z",
    toolType: "mcp",
    inputSchema: {},
    rateLimit: "120/minute",
    secrets: [],
    auditPolicy: "log-metadata"
  };
}

function createStore() {
  let state: DurableSchedulerState | null = null;
  const store: DurableSchedulerStore & { snapshot: () => DurableSchedulerState | null } = {
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

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "cron_due",
    tenantId: "tenant_demo",
    name: "Due job",
    schedule: "*/5 * * * *",
    timezone: "Asia/Kolkata",
    ownerId: "usr_admin",
    tier: "team",
    prompt: "Run the governed job.",
    allowedTools: ["tool_brain_query"],
    dataScopes: ["team"],
    budgetUsd: 2,
    retryPolicy: "exponential",
    maxRuntimeSeconds: 60,
    approvalGates: [],
    nextRunAt: "2026-06-29T10:00:00.000Z",
    enabled: true,
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

describe("durable scheduler", () => {
  it("stores cron definitions with runtime policy fields", async () => {
    const scheduler = createDurableScheduler({ store: createStore(), registryItems: [tool()] });

    const stored = await scheduler.upsertJob(job());

    expect(stored).toMatchObject({
      id: "cron_due",
      nextRunAt: "2026-06-29T10:00:00.000Z",
      timezone: "Asia/Kolkata",
      ownerId: "usr_admin",
      tier: "team",
      allowedTools: ["tool_brain_query"],
      budgetUsd: 2,
      retryPolicy: "exponential",
      maxRuntimeSeconds: 60,
      approvalGates: []
    });
    expect((await scheduler.listJobs()).map((item) => item.id)).toContain("cron_due");
  });

  it("leases due work once across competing workers", async () => {
    const scheduler = createDurableScheduler({
      store: createStore(),
      registryItems: [tool()],
      now: () => "2026-06-29T10:00:00.000Z"
    });
    await scheduler.upsertJob(job({ id: "cron_a" }));
    await scheduler.upsertJob(job({ id: "cron_b" }));

    const first = await scheduler.leaseDueJobs({ workerId: "worker_a", limit: 10 });
    const second = await scheduler.leaseDueJobs({ workerId: "worker_b", limit: 10 });

    expect(first.leases).toHaveLength(2);
    expect(second.leases).toHaveLength(0);
    expect(new Set(first.leases.map((lease) => lease.jobId)).size).toBe(2);
    expect((await scheduler.getState()).runs.every((run) => run.status === "queued")).toBe(true);
  });

  it("executes allowed tools through the tool invocation gateway", async () => {
    const gateway = { invoke: vi.fn(async () => ({ status: "succeeded", record: { id: "tool_invocation_1" } })) };
    const scheduler = createDurableScheduler({
      store: createStore(),
      registryItems: [tool()],
      toolGateway: gateway,
      now: () => "2026-06-29T10:00:00.000Z"
    });
    await scheduler.upsertJob(job());
    const lease = (await scheduler.leaseDueJobs({ workerId: "worker_a", limit: 1 })).leases[0];

    const result = await scheduler.executeLease({ leaseId: lease.id, workerId: "worker_a", principal });

    expect(gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ id: "tool_brain_query" }), sessionPurpose: "cron-job", budgetUsd: 2 }));
    expect(result.run.status).toBe("succeeded");
    expect(result.run.toolInvocationIds).toContain("tool_invocation_1");
  });

  it("records approval-paused, retried, failed, and canceled states", async () => {
    const scheduler = createDurableScheduler({
      store: createStore(),
      registryItems: [tool()],
      toolGateway: { invoke: vi.fn(async () => ({ status: "failed", record: { id: "tool_invocation_failed" } })) },
      now: () => "2026-06-29T10:00:00.000Z"
    });
    await scheduler.upsertJob(job({ id: "cron_approval", approvalGates: ["restricted-output"] }));
    await scheduler.upsertJob(job({ id: "cron_retry", retryPolicy: "linear" }));
    await scheduler.upsertJob(job({ id: "cron_fail", retryPolicy: "none" }));
    const leases = (await scheduler.leaseDueJobs({ workerId: "worker_a", limit: 3 })).leases;

    const approval = await scheduler.executeLease({ leaseId: leases.find((lease) => lease.jobId === "cron_approval")!.id, workerId: "worker_a", principal });
    const retried = await scheduler.executeLease({ leaseId: leases.find((lease) => lease.jobId === "cron_retry")!.id, workerId: "worker_a", principal });
    const failed = await scheduler.executeLease({ leaseId: leases.find((lease) => lease.jobId === "cron_fail")!.id, workerId: "worker_a", principal });
    const canceled = await scheduler.cancelRun({ runId: retried.run.id, actorId: "usr_admin" });

    expect(approval.run.status).toBe("needs-approval");
    expect(retried.run.status).toBe("retried");
    expect(failed.run.status).toBe("failed");
    expect(canceled.run.status).toBe("canceled");
    expect((await scheduler.getState()).transitions.map((transition) => transition.status)).toEqual(expect.arrayContaining(["queued", "running", "needs-approval", "retried", "failed", "canceled"]));
  });

  it("leases 1,000 due jobs without duplicate runs", async () => {
    const scheduler = createDurableScheduler({
      store: createStore(),
      registryItems: [tool()],
      now: () => "2026-06-29T10:00:00.000Z"
    });
    for (let index = 0; index < 1000; index += 1) {
      await scheduler.upsertJob(job({ id: `cron_${index}`, allowedTools: [] }));
    }

    const first = await scheduler.leaseDueJobs({ workerId: "worker_a", limit: 1000 });
    const second = await scheduler.leaseDueJobs({ workerId: "worker_b", limit: 1000 });
    const runIds = first.leases.map((lease) => lease.runId);

    expect(first.leases).toHaveLength(1000);
    expect(second.leases).toHaveLength(0);
    expect(new Set(runIds).size).toBe(1000);
  });

  it("serves job upsert, lease, execute, and status through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-durable-scheduler-"));
    process.env.DURABLE_SCHEDULER_STATE_PATH = join(dir, "scheduler.json");
    vi.resetModules();
    const jobsRoute = await import("../app/api/v1/scheduler/jobs/route");
    const leaseRoute = await import("../app/api/v1/scheduler/lease/route");
    const executeRoute = await import("../app/api/v1/scheduler/leases/[id]/execute/route");
    const statusRoute = await import("../app/api/v1/scheduler/status/route");

    const jobResponse = await jobsRoute.POST(jsonRequest("/api/v1/scheduler/jobs", job({ allowedTools: [] })));
    const leaseResponse = await leaseRoute.POST(jsonRequest("/api/v1/scheduler/lease", { workerId: "worker_a", limit: 1, now: "2026-06-29T10:00:00.000Z" }));
    const leasePayload = await leaseResponse.json();
    const executeResponse = await executeRoute.POST(jsonRequest(`/api/v1/scheduler/leases/${leasePayload.leases[0].id}/execute`, { principal }), {
      params: Promise.resolve({ id: leasePayload.leases[0].id })
    });
    const statusResponse = await statusRoute.GET();
    const statusPayload = await statusResponse.json();

    expect(jobResponse.status).toBe(201);
    expect(leaseResponse.status).toBe(200);
    expect(executeResponse.status).toBe(200);
    expect(statusPayload.runs.some((run: { status: string }) => run.status === "succeeded")).toBe(true);
  });
});
