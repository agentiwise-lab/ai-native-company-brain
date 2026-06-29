import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { registry as seedRegistry } from "./seed";
import { toolInvocationGateway } from "./tool-invocation-gateway";
import type { AgentTarget, BrainEvent, BrainTier, Principal, ToolDefinition } from "./types";

export type DurableRunStatus = "queued" | "running" | "succeeded" | "failed" | "retried" | "canceled" | "needs-approval";

export type DurableSchedulerJob = {
  id: string;
  tenantId: string;
  name: string;
  schedule: string;
  timezone: string;
  ownerId: string;
  tier: BrainTier;
  prompt: string;
  allowedTools: string[];
  dataScopes: string[];
  budgetUsd: number;
  retryPolicy: "none" | "linear" | "exponential";
  maxRuntimeSeconds: number;
  approvalGates: string[];
  nextRunAt: string;
  enabled: boolean;
  agentRunner?: AgentTarget;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
};

export type SchedulerLease = {
  id: string;
  jobId: string;
  runId: string;
  workerId: string;
  expiresAt: string;
  createdAt: string;
};

export type DurableSchedulerRun = {
  id: string;
  jobId: string;
  status: DurableRunStatus;
  attempt: number;
  workerId?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output: string;
  auditEventIds: string[];
  toolInvocationIds: string[];
  error?: string;
};

export type DurableRunTransition = {
  id: string;
  runId: string;
  jobId: string;
  status: DurableRunStatus;
  workerId?: string;
  at: string;
  detail: string;
};

export type DurableSchedulerState = {
  jobs: DurableSchedulerJob[];
  leases: SchedulerLease[];
  runs: DurableSchedulerRun[];
  transitions: DurableRunTransition[];
  auditEvents: BrainEvent[];
};

export type DurableSchedulerStore = {
  read(): Promise<DurableSchedulerState | null>;
  write(state: DurableSchedulerState): Promise<void>;
};

type ToolGateway = {
  invoke(input: {
    principal: Principal;
    tool: ToolDefinition;
    connectedAccountId: string;
    sessionPurpose: "cron-job";
    packageVersion: string;
    args: Record<string, unknown>;
    budgetUsd: number;
    requiresApproval?: boolean;
  }): Promise<{ status: string; record?: { id?: string } }>;
};

type SchedulerOptions = {
  store?: DurableSchedulerStore;
  registryItems?: unknown[];
  toolGateway?: ToolGateway;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type UpsertJobInput = Omit<DurableSchedulerJob, "createdAt" | "updatedAt" | "maxAttempts"> & {
  maxAttempts?: number;
};

type LeaseInput = {
  workerId: string;
  limit?: number;
  leaseMs?: number;
  now?: string;
};

type ExecuteInput = {
  leaseId: string;
  workerId: string;
  principal: Principal;
};

function defaultStatePath() {
  return process.env.DURABLE_SCHEDULER_STATE_PATH ?? join(process.cwd(), "data", "durable-scheduler-state.json");
}

function createFileStore(path = defaultStatePath()): DurableSchedulerStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as DurableSchedulerState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): DurableSchedulerState {
  return {
    jobs: [],
    leases: [],
    runs: [],
    transitions: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

function nextRunAfter(job: DurableSchedulerJob, timestamp: string) {
  const everyMatch = job.schedule.match(/^\*\/(\d+) \* \* \* \*$/);
  return addMinutes(timestamp, everyMatch ? Math.max(1, Number(everyMatch[1])) : 60);
}

function retryDelayMinutes(job: DurableSchedulerJob, attempt: number) {
  if (job.retryPolicy === "linear") {
    return 1;
  }
  if (job.retryPolicy === "exponential") {
    return Math.min(60, 2 ** Math.max(0, attempt - 1));
  }
  return 0;
}

function isTool(item: unknown): item is ToolDefinition {
  if (!item || typeof item !== "object") {
    return false;
  }
  return "kind" in item && (item as { kind?: string }).kind === "tool";
}

function createTransition(input: {
  id: string;
  run: DurableSchedulerRun;
  status: DurableRunStatus;
  at: string;
  workerId?: string;
  detail: string;
}): DurableRunTransition {
  return {
    id: input.id,
    runId: input.run.id,
    jobId: input.run.jobId,
    status: input.status,
    workerId: input.workerId,
    at: input.at,
    detail: input.detail
  };
}

function runSnapshot(run: DurableSchedulerRun): DurableSchedulerRun {
  return {
    ...run,
    auditEventIds: [...run.auditEventIds],
    toolInvocationIds: [...run.toolInvocationIds]
  };
}

function jobSnapshot(job: DurableSchedulerJob): DurableSchedulerJob {
  return {
    ...job,
    allowedTools: [...job.allowedTools],
    dataScopes: [...job.dataScopes],
    approvalGates: [...job.approvalGates]
  };
}

export function createDurableScheduler(options: SchedulerOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const tools = registryItems.filter(isTool);
  const gateway = options.toolGateway ?? toolInvocationGateway;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: DurableSchedulerState) {
    await store.write(state);
  }

  function findTool(toolId: string) {
    return tools.find((tool) => tool.id === toolId || tool.slug === toolId);
  }

  function transition(state: DurableSchedulerState, run: DurableSchedulerRun, status: DurableRunStatus, timestamp: string, detail: string, workerId?: string) {
    state.transitions = [
      createTransition({
        id: id("scheduler_transition"),
        run,
        status,
        at: timestamp,
        detail,
        workerId
      }),
      ...state.transitions
    ];
  }

  async function updateRunStatus(input: {
    state: DurableSchedulerState;
    run: DurableSchedulerRun;
    job: DurableSchedulerJob;
    status: DurableRunStatus;
    timestamp: string;
    workerId?: string;
    output: string;
    error?: string;
  }) {
    input.run.status = input.status;
    input.run.output = input.output;
    input.run.error = input.error;
    if (input.status === "running") {
      input.run.startedAt = input.timestamp;
    }
    if (!["queued", "running"].includes(input.status)) {
      input.run.finishedAt = input.timestamp;
      input.run.durationMs = Math.max(0, Date.parse(input.timestamp) - Date.parse(input.run.startedAt ?? input.timestamp));
    }
    transition(input.state, input.run, input.status, input.timestamp, input.output, input.workerId);
  }

  return {
    async getState() {
      return load();
    },

    async listJobs() {
      return (await load()).jobs;
    },

    async upsertJob(input: UpsertJobInput) {
      const state = await load();
      const timestamp = now();
      const existing = state.jobs.find((job) => job.id === input.id);
      const job: DurableSchedulerJob = {
        ...input,
        maxAttempts: input.maxAttempts ?? 3,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      state.jobs = [job, ...state.jobs.filter((candidate) => candidate.id !== job.id)];
      await save(state);
      return job;
    },

    async leaseDueJobs(input: LeaseInput) {
      const state = await load();
      const timestamp = input.now ?? now();
      const limit = input.limit ?? 10;
      const leaseMs = input.leaseMs ?? 120_000;
      const due = latestDueJobs(state.jobs, timestamp).filter((job) => {
        const activeLease = state.leases.find((lease) => lease.jobId === job.id && Date.parse(lease.expiresAt) > Date.parse(timestamp));
        return !activeLease;
      });
      const leases: SchedulerLease[] = [];

      for (const job of due.slice(0, limit)) {
        const run: DurableSchedulerRun = {
          id: id("scheduler_run"),
          jobId: job.id,
          status: "queued",
          attempt: 1,
          workerId: input.workerId,
          queuedAt: timestamp,
          output: "Queued for scheduler execution.",
          auditEventIds: [],
          toolInvocationIds: []
        };
        const lease: SchedulerLease = {
          id: id("scheduler_lease"),
          jobId: job.id,
          runId: run.id,
          workerId: input.workerId,
          expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
          createdAt: timestamp
        };
        state.runs = [run, ...state.runs];
        state.leases = [lease, ...state.leases];
        transition(state, run, "queued", timestamp, "Queued for scheduler execution.", input.workerId);
        leases.push(lease);
      }

      await save(state);
      return { leases };
    },

    async executeLease(input: ExecuteInput) {
      const state = await load();
      const timestamp = now();
      const lease = state.leases.find((candidate) => candidate.id === input.leaseId && candidate.workerId === input.workerId);
      if (!lease) {
        throw new Error(`Lease ${input.leaseId} was not found for worker ${input.workerId}.`);
      }
      const job = state.jobs.find((candidate) => candidate.id === lease.jobId);
      const run = state.runs.find((candidate) => candidate.id === lease.runId);
      if (!job || !run) {
        throw new Error(`Lease ${input.leaseId} references missing scheduler state.`);
      }

      await updateRunStatus({ state, run, job, status: "running", timestamp, workerId: input.workerId, output: "Scheduler run started." });

      if (job.approvalGates.length > 0) {
        await updateRunStatus({
          state,
          run,
          job,
          status: "needs-approval",
          timestamp,
          workerId: input.workerId,
          output: `Approval required: ${job.approvalGates.join(", ")}.`
        });
        state.leases = state.leases.filter((candidate) => candidate.id !== lease.id);
        await save(state);
        return { job: jobSnapshot(job), run: runSnapshot(run) };
      }

      if (job.budgetUsd <= 0) {
        await updateRunStatus({
          state,
          run,
          job,
          status: "failed",
          timestamp,
          workerId: input.workerId,
          output: "Scheduler budget exhausted.",
          error: "Budget must be positive."
        });
        state.leases = state.leases.filter((candidate) => candidate.id !== lease.id);
        await save(state);
        return { job: jobSnapshot(job), run: runSnapshot(run) };
      }

      const invocationIds: string[] = [];
      const failures: string[] = [];
      for (const toolId of job.allowedTools) {
        const tool = findTool(toolId);
        if (!tool) {
          failures.push(`Tool ${toolId} was not found.`);
          continue;
        }
        const invocation = await gateway.invoke({
          principal: input.principal,
          tool,
          connectedAccountId: `cron:${job.id}`,
          sessionPurpose: "cron-job",
          packageVersion: tool.version,
          args: {
            prompt: job.prompt,
            dataScopes: job.dataScopes,
            cronJobId: job.id
          },
          budgetUsd: job.budgetUsd,
          requiresApproval: false
        });
        if (invocation.record?.id) {
          invocationIds.push(invocation.record.id);
        }
        if (invocation.status !== "succeeded") {
          failures.push(`Tool ${tool.slug} returned ${invocation.status}.`);
        }
      }
      run.toolInvocationIds = invocationIds;

      const eventId = id("evt_scheduler_run");
      const auditEvent: BrainEvent = {
        id: eventId,
        tenantId,
        actorId: input.principal.id,
        action: "cron.run",
        targetId: run.id,
        targetType: "cron-run",
        policyDecision: failures.length === 0 ? "allow" : "deny",
        metadata: {
          jobId: job.id,
          workerId: input.workerId,
          toolInvocationIds: invocationIds,
          failures
        },
        createdAt: timestamp
      };
      run.auditEventIds = [eventId, ...run.auditEventIds];
      state.auditEvents = [auditEvent, ...state.auditEvents];

      if (failures.length > 0) {
        if (job.retryPolicy !== "none" && run.attempt < job.maxAttempts) {
          const retryAt = addMinutes(timestamp, retryDelayMinutes(job, run.attempt));
          job.nextRunAt = retryAt;
          run.attempt += 1;
          await updateRunStatus({
            state,
            run,
            job,
            status: "retried",
            timestamp,
            workerId: input.workerId,
            output: `Retry scheduled at ${retryAt}.`,
            error: failures.join(" ")
          });
        } else {
          await updateRunStatus({
            state,
            run,
            job,
            status: "failed",
            timestamp,
            workerId: input.workerId,
            output: failures.join(" "),
            error: failures.join(" ")
          });
        }
      } else {
        job.nextRunAt = nextRunAfter(job, timestamp);
        await updateRunStatus({
          state,
          run,
          job,
          status: "succeeded",
          timestamp,
          workerId: input.workerId,
          output: job.allowedTools.length > 0 ? "Scheduler run succeeded through governed tools." : "Scheduler run succeeded."
        });
      }

      state.leases = state.leases.filter((candidate) => candidate.id !== lease.id);
      state.jobs = [job, ...state.jobs.filter((candidate) => candidate.id !== job.id)];
      await save(state);
      return { job: jobSnapshot(job), run: runSnapshot(run) };
    },

    async cancelRun(input: { runId: string; actorId: string }) {
      const state = await load();
      const timestamp = now();
      const run = state.runs.find((candidate) => candidate.id === input.runId);
      const job = run ? state.jobs.find((candidate) => candidate.id === run.jobId) : undefined;
      if (!run || !job) {
        throw new Error(`Run ${input.runId} was not found.`);
      }
      await updateRunStatus({
        state,
        run,
        job,
        status: "canceled",
        timestamp,
        workerId: run.workerId,
        output: `Canceled by ${input.actorId}.`
      });
      state.leases = state.leases.filter((lease) => lease.runId !== run.id);
      await save(state);
      return { job: jobSnapshot(job), run: runSnapshot(run) };
    }
  };
}

function latestDueJobs(jobs: DurableSchedulerJob[], timestamp: string) {
  return [...jobs]
    .filter((job) => job.enabled && Date.parse(job.nextRunAt) <= Date.parse(timestamp))
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
}

export const durableScheduler = createDurableScheduler();
