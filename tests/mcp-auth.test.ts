import { describe, expect, it } from "vitest";
import { POST as mcpPost } from "../app/api/mcp/route";

function token(principalId = "usr_reviewer") {
  return `Bearer tenant_demo.${principalId}.mcp_dev_key`;
}

function mcpRequest(body: unknown, authorization = token()) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: authorization
      ? {
          "content-type": "application/json",
          authorization
        }
      : {
          "content-type": "application/json"
        },
    body: JSON.stringify(body)
  });
}

async function callMcp(body: unknown, authorization = token()) {
  const response = await mcpPost(mcpRequest(body, authorization));
  return response.json();
}

describe("authenticated MCP endpoint", () => {
  it("rejects unauthorized MCP clients", async () => {
    const payload = await callMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "");

    expect(payload.error).toMatchObject({
      code: -32001,
      message: expect.stringMatching(/unauthorized/i)
    });
  });

  it("initializes with tenant and principal context", async () => {
    const payload = await callMcp({ jsonrpc: "2.0", id: 1, method: "initialize" });

    expect(payload.result.serverInfo).toMatchObject({
      name: "company-brain",
      principalId: "usr_reviewer",
      tenantId: "tenant_demo"
    });
  });

  it("lists only principal-allowed MCP tools", async () => {
    const payload = await callMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token("agent_codex"));
    const names = payload.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain("brain.query");
    expect(names).toContain("registry.search");
    expect(names).not.toContain("brain.commit");
  });

  it("returns cited brain query results for the authenticated principal", async () => {
    const payload = await callMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "brain.query",
        arguments: {
          query: "promotion"
        }
      }
    });
    const result = JSON.parse(payload.result.content[0].text);

    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]).toMatchObject({ status: "approved" });
  });

  it("denies forbidden tool calls for the authenticated principal", async () => {
    const payload = await callMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "brain.commit",
          arguments: {
            title: "Forbidden",
            body: "Agent should not write memory."
          }
        }
      },
      token("agent_codex")
    );

    expect(payload.error).toMatchObject({
      code: -32003,
      message: expect.stringMatching(/brain:write/i)
    });
  });

  it("blocks Composio-backed tool invocation for revoked connected accounts", async () => {
    const payload = await callMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "tool.invoke",
        arguments: {
          toolId: "tool_brain_query",
          connectedAccount: {
            id: "acct_revoked",
            status: "revoked",
            principalId: "usr_reviewer"
          },
          input: { query: "promotion" }
        }
      }
    });

    expect(payload.error).toMatchObject({
      code: -32003,
      message: expect.stringMatching(/revoked/i)
    });
  });
});
