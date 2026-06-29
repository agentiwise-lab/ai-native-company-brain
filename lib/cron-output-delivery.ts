import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { registry as seedRegistry } from "./seed";
import { toolInvocationGateway } from "./tool-invocation-gateway";
import type { BrainEvent, Principal, ToolDefinition } from "./types";

export type CronOutputDestinationType = "slack" | "email" | "webhook" | "dashboard";
export type CronOutputDeliveryStatus = "delivered" | "needs-approval" | "blocked" | "failed" | "suppressed";

export type CronOutputDestination = {
  id: string;
  type: CronOutputDestinationType;
  uri: string;
  toolId?: string;
  connectedAccountId?: string;
  requiresApproval?: boolean;
  quietWindowMinutes?: number;
};

export type CronOutputDeliveryRecord = {
  id: string;
  cronJobId: string;
  runId: string;
  destinationId: string;
  destinationType: CronOutputDestinationType;
  status: CronOutputDeliveryStatus;
  destinationLink?: string;
  toolInvocationId?: string;
  reason?: string;
  dedupeKey?: string;
  createdAt: string;
};

export type CronOutputApproval = {
  id: string;
  cronJobId: string;
  runId: string;
  destinationId: string;
  reviewerContext: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type DashboardOutput = {
  id: string;
  cronJobId: string;
  runId: string;
  output: string;
  link: string;
  createdAt: string;
};

export type CronOutputDeliveryState = {
  deliveries: CronOutputDeliveryRecord[];
  approvals: CronOutputApproval[];
  dashboardOutputs: DashboardOutput[];
  auditEvents: BrainEvent[];
};

export type CronOutputDeliveryStore = {
  read(): Promise<CronOutputDeliveryState | null>;
  write(state: CronOutputDeliveryState): Promise<void>;
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
  }): Promise<{ status: string; record?: { id?: string }; decision?: { reasons?: string[] } }>;
};

type WebhookClient = {
  post(uri: string, payload: Record<string, unknown>): Promise<{ link?: string } | void>;
};

type ServiceOptions = {
  store?: CronOutputDeliveryStore;
  registryItems?: unknown[];
  toolGateway?: ToolGateway;
  webhookClient?: WebhookClient;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

export type CronOutputDeliveryInput = {
  principal: Principal;
  cronJobId: string;
  runId: string;
  output: string;
  allowedTools: string[];
  budgetUsd: number;
  destinations: CronOutputDestination[];
  dedupeKey?: string;
  sensitive?: boolean;
};

function defaultStatePath() {
  return process.env.CRON_OUTPUT_DELIVERY_STATE_PATH ?? join(process.cwd(), "data", "cron-output-delivery-state.json");
}

function createFileStore(path = defaultStatePath()): CronOutputDeliveryStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as CronOutputDeliveryState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): CronOutputDeliveryState {
  return {
    deliveries: [],
    approvals: [],
    dashboardOutputs: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isTool(item: unknown): item is ToolDefinition {
  if (!item || typeof item !== "object") {
    return false;
  }
  return "kind" in item && (item as { kind?: string }).kind === "tool";
}

function isSensitive(input: CronOutputDeliveryInput, destination: CronOutputDestination) {
  return Boolean(input.sensitive || destination.requiresApproval || /(restricted|confidential|secret|token|customer revenue)/i.test(input.output));
}

function outputExcerpt(output: string) {
  return output.length > 240 ? `${output.slice(0, 237)}...` : output;
}

function auditDecision(status: CronOutputDeliveryStatus): BrainEvent["policyDecision"] {
  if (status === "delivered" || status === "suppressed") {
    return "allow";
  }
  if (status === "needs-approval") {
    return "needs-approval";
  }
  return "deny";
}

export function createCronOutputDelivery(options: ServiceOptions = {}) {
  const store = options.store ?? createFileStore();
  const registryItems = options.registryItems ?? seedRegistry;
  const tools = registryItems.filter(isTool);
  const gateway = options.toolGateway ?? toolInvocationGateway;
  const webhookClient = options.webhookClient ?? {
    async post(uri: string) {
      return { link: uri };
    }
  };
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: CronOutputDeliveryState) {
    await store.write(state);
  }

  function findTool(toolId?: string) {
    return toolId ? tools.find((tool) => tool.id === toolId || tool.slug === toolId) : undefined;
  }

  function makeDelivery(input: {
    cronJobId: string;
    runId: string;
    destination: CronOutputDestination;
    status: CronOutputDeliveryStatus;
    createdAt: string;
    destinationLink?: string;
    toolInvocationId?: string;
    reason?: string;
    dedupeKey?: string;
  }): CronOutputDeliveryRecord {
    return {
      id: id("cron_output_delivery"),
      cronJobId: input.cronJobId,
      runId: input.runId,
      destinationId: input.destination.id,
      destinationType: input.destination.type,
      status: input.status,
      destinationLink: input.destinationLink,
      toolInvocationId: input.toolInvocationId,
      reason: input.reason,
      dedupeKey: input.dedupeKey,
      createdAt: input.createdAt
    };
  }

  function makeAudit(input: CronOutputDeliveryInput, delivery: CronOutputDeliveryRecord, timestamp: string): BrainEvent {
    return {
      id: id("evt_cron_output"),
      tenantId,
      actorId: input.principal.id,
      action: "cron.run",
      targetId: input.runId,
      targetType: "cron-run",
      policyDecision: auditDecision(delivery.status),
      metadata: {
        cronJobId: input.cronJobId,
        destinationId: delivery.destinationId,
        destinationType: delivery.destinationType,
        status: delivery.status,
        reason: delivery.reason,
        destinationLink: delivery.destinationLink,
        toolInvocationId: delivery.toolInvocationId
      },
      createdAt: timestamp
    };
  }

  function suppressed(state: CronOutputDeliveryState, destination: CronOutputDestination, input: CronOutputDeliveryInput, timestamp: string) {
    if (!input.dedupeKey || !destination.quietWindowMinutes) {
      return false;
    }
    const windowStart = Date.parse(timestamp) - destination.quietWindowMinutes * 60_000;
    return state.deliveries.some(
      (delivery) =>
        delivery.destinationId === destination.id &&
        delivery.dedupeKey === input.dedupeKey &&
        delivery.status === "delivered" &&
        Date.parse(delivery.createdAt) >= windowStart
    );
  }

  return {
    async getState() {
      return load();
    },

    async deliver(input: CronOutputDeliveryInput) {
      const state = await load();
      const timestamp = now();
      const deliveries: CronOutputDeliveryRecord[] = [];
      const approvals: CronOutputApproval[] = [];
      const auditEvents: BrainEvent[] = [];

      for (const destination of input.destinations) {
        let delivery: CronOutputDeliveryRecord;
        if (suppressed(state, destination, input, timestamp)) {
          delivery = makeDelivery({
            cronJobId: input.cronJobId,
            runId: input.runId,
            destination,
            status: "suppressed",
            reason: "Duplicate notification suppressed by quiet window.",
            dedupeKey: input.dedupeKey,
            createdAt: timestamp
          });
        } else if (isSensitive(input, destination)) {
          delivery = makeDelivery({
            cronJobId: input.cronJobId,
            runId: input.runId,
            destination,
            status: "needs-approval",
            reason: "Sensitive output requires reviewer approval.",
            dedupeKey: input.dedupeKey,
            createdAt: timestamp
          });
          approvals.push({
            id: id("cron_output_approval"),
            cronJobId: input.cronJobId,
            runId: input.runId,
            destinationId: destination.id,
            reviewerContext: outputExcerpt(input.output),
            status: "pending",
            createdAt: timestamp
          });
        } else if ((destination.type === "slack" || destination.type === "email") && (!destination.toolId || !input.allowedTools.includes(destination.toolId))) {
          delivery = makeDelivery({
            cronJobId: input.cronJobId,
            runId: input.runId,
            destination,
            status: "blocked",
            reason: `Destination tool ${destination.toolId ?? "missing"} is not allowed for this cron job.`,
            dedupeKey: input.dedupeKey,
            createdAt: timestamp
          });
        } else if (destination.type === "slack" || destination.type === "email") {
          const tool = findTool(destination.toolId);
          if (!tool) {
            delivery = makeDelivery({
              cronJobId: input.cronJobId,
              runId: input.runId,
              destination,
              status: "blocked",
              reason: `Destination tool ${destination.toolId} was not found.`,
              dedupeKey: input.dedupeKey,
              createdAt: timestamp
            });
          } else {
            const invocation = await gateway.invoke({
              principal: input.principal,
              tool,
              connectedAccountId: destination.connectedAccountId ?? destination.id,
              sessionPurpose: "cron-job",
              packageVersion: tool.version,
              args: {
                cronJobId: input.cronJobId,
                runId: input.runId,
                output: input.output,
                destination: destination.uri
              },
              budgetUsd: input.budgetUsd,
              requiresApproval: false
            });
            const reason = invocation.decision?.reasons?.join(" ") ?? `Tool invocation returned ${invocation.status}.`;
            delivery = makeDelivery({
              cronJobId: input.cronJobId,
              runId: input.runId,
              destination,
              status: invocation.status === "succeeded" ? "delivered" : "blocked",
              destinationLink: invocation.status === "succeeded" ? destination.uri : undefined,
              toolInvocationId: invocation.record?.id,
              reason: invocation.status === "succeeded" ? undefined : reason,
              dedupeKey: input.dedupeKey,
              createdAt: timestamp
            });
          }
        } else if (destination.type === "webhook") {
          try {
            const result = await webhookClient.post(destination.uri, {
              cronJobId: input.cronJobId,
              runId: input.runId,
              output: input.output
            });
            delivery = makeDelivery({
              cronJobId: input.cronJobId,
              runId: input.runId,
              destination,
              status: "delivered",
              destinationLink: result?.link ?? destination.uri,
              dedupeKey: input.dedupeKey,
              createdAt: timestamp
            });
          } catch (error) {
            delivery = makeDelivery({
              cronJobId: input.cronJobId,
              runId: input.runId,
              destination,
              status: "failed",
              reason: error instanceof Error ? error.message : "Webhook delivery failed.",
              dedupeKey: input.dedupeKey,
              createdAt: timestamp
            });
          }
        } else {
          const outputId = id("dashboard_output");
          const dashboard: DashboardOutput = {
            id: outputId,
            cronJobId: input.cronJobId,
            runId: input.runId,
            output: input.output,
            link: `dashboard://cron-output/${outputId}`,
            createdAt: timestamp
          };
          state.dashboardOutputs = [dashboard, ...state.dashboardOutputs];
          delivery = makeDelivery({
            cronJobId: input.cronJobId,
            runId: input.runId,
            destination,
            status: "delivered",
            destinationLink: dashboard.link,
            dedupeKey: input.dedupeKey,
            createdAt: timestamp
          });
        }

        deliveries.push(delivery);
        auditEvents.push(makeAudit(input, delivery, timestamp));
      }

      state.deliveries = [...deliveries, ...state.deliveries];
      state.approvals = [...approvals, ...state.approvals];
      state.auditEvents = [...auditEvents, ...state.auditEvents];
      await save(state);

      return {
        deliveries,
        approvals,
        auditEvents
      };
    }
  };
}

export const cronOutputDelivery = createCronOutputDelivery();
