import { generateAllAdapters } from "./adapters";
import { repository } from "./repository";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
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

export function handleMcpRequest(request: JsonRpcRequest) {
  const id = request.id ?? null;

  switch (request.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: "2025-06-18",
        serverInfo: {
          name: "company-brain",
          version: "0.1.0"
        },
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      });

    case "tools/list":
      return ok(id, {
        tools: [
          {
            name: "brain.query",
            description: "Query governed organizational memory with ACL-filtered citations.",
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
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "cron.run_now",
            description: "Run a registered cron workflow through the policy and audit layer.",
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
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string" }
              },
              required: ["id"]
            }
          }
        ]
      });

    case "tools/call": {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments ?? {}) as Record<string, string>;

      if (name === "brain.query" || name === "brain-query") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(repository.queryBrain(args.query ?? "", undefined, args.tier as never), null, 2)
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
                repository.commitBrain({
                  title: args.title ?? "Untitled candidate memory",
                  body: args.body ?? "",
                  tier: args.tier as never
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
              text: JSON.stringify(repository.searchRegistry(args.query ?? "", args.kind as never), null, 2)
            }
          ]
        });
      }

      if (name === "skill.resolve") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(generateAllAdapters(repository.registry), null, 2)
            }
          ]
        });
      }

      if (name === "cron.run_now") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(repository.runCronJob(args.id ?? ""), null, 2)
            }
          ]
        });
      }

      if (name === "audit.trace") {
        return ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(repository.lineage(args.id ?? ""), null, 2)
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
              text: JSON.stringify(repository.dashboard(), null, 2)
            }
          ]
        });
      }

      if (uri === "brain://registry") {
        return ok(id, {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(repository.registry, null, 2)
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
