import { generateAllAdapters } from "./adapters";
import { canInvokeRegistryItem } from "./policy";
import { repository } from "./repository";
import type { Principal } from "./types";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type McpContext = {
  tenantId: string;
  principalId: string;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScope?: string;
};

function ok(id: JsonRpcRequest["id"], result: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result
  };
}

function error(id: JsonRpcRequest["id"], code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function localApiKey() {
  return process.env.MCP_LOCAL_API_KEY ?? "mcp_dev_key";
}

export function authenticateMcpRequest(request: Request): McpContext | null {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const [tenantId, principalId, apiKey] = bearer.split(".");
    if (tenantId && principalId && apiKey === localApiKey()) {
      return { tenantId, principalId };
    }
  }

  const apiKey = request.headers.get("x-api-key");
  const tenantId = request.headers.get("x-tenant-id");
  const principalId = request.headers.get("x-principal-id");
  if (apiKey === localApiKey() && tenantId && principalId) {
    return { tenantId, principalId };
  }

  return null;
}

function scopeAllowed(principal: Principal, scope?: string) {
  if (!scope) {
    return true;
  }
  if (principal.scopes.includes(scope)) {
    return true;
  }
  if (scope === "registry:read" && principal.scopes.some((candidate) => candidate.startsWith("registry:"))) {
    return true;
  }
  return false;
}

const baseTools: McpTool[] = [
  {
    name: "brain.query",
    description: "Query governed organizational memory with ACL-filtered citations.",
    requiredScope: "brain:read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        tier: { type: "string" }
      },
      required: ["query"]
    }
  },
  {
    name: "brain.commit",
    description: "Create a candidate memory atom and open a review changeset.",
    requiredScope: "brain:write",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        tier: { type: "string" }
      },
      required: ["title", "body"]
    }
  },
  {
    name: "registry.search",
    description: "Search approved tools, skills, plugins, agents, policies, and cron jobs.",
    requiredScope: "registry:read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kind: { type: "string" }
      }
    }
  },
  {
    name: "skill.resolve",
    description: "Generate Codex, Claude Code, OpenCode, and generic agent adapter files for approved skills.",
    requiredScope: "registry:read",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "tool.invoke",
    description: "Invoke an approved registry tool through MCP policy and connected-account checks.",
    requiredScope: "registry:read",
    inputSchema: {
      type: "object",
      properties: {
        toolId: { type: "string" },
        connectedAccount: { type: "object" },
        input: { type: "object" }
      },
      required: ["toolId"]
    }
  },
  {
    name: "cron.run_now",
    description: "Run a registered cron workflow through the policy and audit layer.",
    requiredScope: "cron:run",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "audit.trace",
    description: "Trace a memory atom to dependencies and audit events.",
    requiredScope: "audit:read",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  }
];

function allowedTools(principal: Principal) {
  return baseTools.filter((tool) => scopeAllowed(principal, tool.requiredScope));
}

function deniedTool(id: JsonRpcRequest["id"], tool: McpTool | undefined, name: string) {
  return error(id, -32003, tool?.requiredScope ? `Tool ${name} requires ${tool.requiredScope}.` : `Tool ${name} is not allowed.`);
}

export async function handleMcpRequest(request: JsonRpcRequest, context?: McpContext | null) {
  const id = request.id ?? null;
  if (!context) {
    return error(id, -32001, "Unauthorized MCP client.");
  }

  const principal = await repository.principal(context.principalId);
  const visibleTools = allowedTools(principal);

  switch (request.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: "2025-06-18",
        serverInfo: {
          name: "company-brain",
          version: "0.1.0",
          tenantId: context.tenantId,
          principalId: context.principalId
        },
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      });

    case "tools/list":
      return ok(id, {
        tools: visibleTools.map(({ requiredScope: _requiredScope, ...tool }) => tool)
      });

    case "tools/call": {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = baseTools.find((candidate) => candidate.name === name || (name === "brain-query" && candidate.name === "brain.query"));
      if (!tool || !visibleTools.some((candidate) => candidate.name === tool.name)) {
        return deniedTool(id, tool, name);
      }

      if (name === "brain.query" || name === "brain-query") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(await repository.queryBrain(String(args.query ?? ""), context.principalId, args.tier as never), null, 2)
            }
          ]
        });
      }

      if (name === "brain.commit") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                await repository.commitBrain({
                  title: String(args.title ?? "Untitled candidate memory"),
                  body: String(args.body ?? ""),
                  tier: args.tier as never,
                  principalId: context.principalId
                }),
                null,
                2
              )
            }
          ]
        });
      }

      if (name === "registry.search") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(await repository.searchRegistry(String(args.query ?? ""), args.kind as never, context.principalId), null, 2)
            }
          ]
        });
      }

      if (name === "skill.resolve") {
        const registry = await repository.allRegistry();
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(generateAllAdapters(registry), null, 2)
            }
          ]
        });
      }

      if (name === "tool.invoke") {
        const connectedAccount = (args.connectedAccount ?? {}) as { id?: string; status?: string };
        if (connectedAccount.status === "revoked") {
          return error(id, -32003, `Connected account ${connectedAccount.id ?? "unknown"} is revoked.`);
        }

        const registry = await repository.allRegistry();
        const item = registry.find((candidate) => candidate.id === String(args.toolId));
        if (!item || item.kind !== "tool") {
          return error(id, -32602, `Registry tool ${String(args.toolId)} was not found.`);
        }
        const decision = canInvokeRegistryItem(principal, item);
        if (!decision.allowed) {
          return error(id, -32003, decision.reason);
        }

        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                invoked: true,
                toolId: item.id,
                connectedAccountId: connectedAccount.id,
                input: args.input ?? {},
                policy: decision
              }, null, 2)
            }
          ]
        });
      }

      if (name === "cron.run_now") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(await repository.runCronJob(String(args.id ?? "")), null, 2)
            }
          ]
        });
      }

      if (name === "audit.trace") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(await repository.lineage(String(args.id ?? "")), null, 2)
            }
          ]
        });
      }

      return error(id, -32601, `Unknown tool: ${name}`);
    }

    case "resources/list":
      return ok(id, {
        resources: [
          {
            uri: "brain://dashboard",
            name: "Company brain dashboard snapshot",
            mimeType: "application/json"
          },
          {
            uri: "brain://registry",
            name: "Approved registry items",
            mimeType: "application/json"
          }
        ]
      });

    case "resources/read": {
      const uri = String(request.params?.uri ?? "");
      if (uri === "brain://dashboard") {
        return ok(id, {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(await repository.dashboard(), null, 2)
            }
          ]
        });
      }

      if (uri === "brain://registry") {
        const registry = await repository.allRegistry();
        return ok(id, {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(registry, null, 2)
            }
          ]
        });
      }

      return error(id, -32602, `Unknown resource: ${uri}`);
    }

    case "prompts/list":
      return ok(id, {
        prompts: [
          {
            name: "open-brain-changeset",
            description: "Open a source-backed changeset for a memory or registry update."
          },
          {
            name: "weekly-brain-health",
            description: "Produce stale-memory, registry-risk, cron-failure, and review-bottleneck report."
          }
        ]
      });

    default:
      return error(id, -32601, `Unknown method: ${request.method ?? "undefined"}`);
  }
}
