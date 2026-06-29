import { describe, expect, it } from "vitest";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";
import { canInvokeRegistryItem } from "../lib/policy";
import type { Principal, ToolDefinition } from "../lib/types";

function jsonRequest(path: string, body: unknown, principalId = "usr_reviewer", method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-principal-id": principalId,
      "x-tenant-id": "tenant_demo"
    },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const employee: Principal = {
  id: "usr_employee",
  name: "Employee",
  email: "employee@example.com",
  role: "employee",
  teams: ["platform"],
  tiers: ["individual", "team"],
  scopes: ["brain:read"]
};

const writeConnector: ToolDefinition = {
  id: "tool_composio_write",
  tenantId: "tenant_demo",
  kind: "tool",
  name: "Composio write connector",
  slug: "composio-write-connector",
  description: "Write-capable connector action.",
  tier: "team",
  ownerId: "usr_admin",
  version: "0.1.0",
  status: "published",
  permissions: ["composio:slack:write"],
  dependencies: [],
  requiredTools: [],
  adapterTargets: ["generic-mcp"],
  updatedAt: "2026-06-29T12:00:00.000Z",
  toolType: "connector",
  inputSchema: {},
  rateLimit: "60/minute/connected-account",
  secrets: ["COMPOSIO_API_KEY"],
  auditPolicy: "log-metadata"
};

describe("ACL enforcement", () => {
  it("excludes protected memory and emits a deny event", async () => {
    const response = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: "Exec hiring",
        principalId: "usr_reviewer"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.citations).toHaveLength(0);
    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyDecision: "deny",
          targetId: "atom_004",
          metadata: expect.objectContaining({
            reason: expect.stringMatching(/exec-protected|role|team/i)
          })
        })
      ])
    );
  });

  it("allows accessible team/company memory and emits an allow event", async () => {
    const response = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: "promotion",
        principalId: "usr_reviewer"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.citations.length).toBeGreaterThan(0);
    expect(payload.events[0]).toMatchObject({
      action: "query",
      policyDecision: "allow"
    });
  });

  it("denies reviewer override for exec-protected changesets", async () => {
    const response = await reviewChangeset(
      jsonRequest(
        "/api/v1/changesets/cs_102/review",
        {
          action: "approve",
          note: "Trying to override protected review."
        },
        "usr_reviewer",
        "PATCH"
      ),
      params("cs_102")
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/exec-protected|review/i);
  });

  it("denies write-capable Composio tool invocation for employees", () => {
    expect(canInvokeRegistryItem(employee, writeConnector)).toEqual({
      allowed: false,
      reason: "Write-capable tools require an admin, reviewer, or operator."
    });
  });
});
