import { handleMcpRequest } from "../lib/mcp";

const context = {
  tenantId: process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo",
  principalId: process.env.MCP_SMOKE_PRINCIPAL_ID ?? "usr_reviewer"
};

async function rpc(method: string, params?: Record<string, unknown>, id = method) {
  return handleMcpRequest({ jsonrpc: "2.0", id, method, params }, context);
}

async function main() {
  const initialize = await rpc("initialize");
  const tools = await rpc("tools/list");
  const query = await rpc("tools/call", {
    name: "brain.query",
    arguments: { query: "promotion" }
  });
  const denied = await handleMcpRequest(
    {
      jsonrpc: "2.0",
      id: "denied",
      method: "tools/call",
      params: {
        name: "brain.commit",
        arguments: { title: "Denied", body: "Agent write should be denied." }
      }
    },
    { tenantId: context.tenantId, principalId: "agent_codex" }
  );
  const revoked = await rpc("tools/call", {
    name: "tool.invoke",
    arguments: {
      toolId: "tool_brain_query",
      connectedAccount: { id: "acct_revoked", status: "revoked", principalId: context.principalId },
      input: { query: "promotion" }
    }
  });

  const summary = { initialize, tools, query, denied, revoked };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
