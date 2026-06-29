import { describe, expect, it } from "vitest";
import { canDiscoverRegistryItem, canReadAtom, enforceChangesetMerge, isTierAtLeast } from "../lib/policy";
import type { KnowledgeAtom, Principal, ToolDefinition } from "../lib/types";

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: []
};

const employee: Principal = {
  ...reviewer,
  id: "usr_employee",
  role: "employee",
  tiers: ["individual", "team"]
};

const atom: KnowledgeAtom = {
  id: "atom_test",
  tenantId: "tenant_test",
  title: "Platform decision",
  body: "Use reviewed changesets for promoted memory.",
  atomType: "decision",
  tier: "team",
  ownerId: "usr_reviewer",
  sourceIds: ["source_1"],
  acl: {
    teams: ["platform"],
    roles: ["admin", "reviewer", "operator", "employee", "agent"],
    sensitivity: "internal"
  },
  status: "approved",
  version: 1,
  confidence: 0.9,
  freshness: 0.95,
  reviewDueAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  tags: ["platform"]
};

const writeTool: ToolDefinition = {
  id: "tool_write",
  tenantId: "tenant_test",
  kind: "tool",
  name: "Write Tool",
  slug: "write-tool",
  description: "Can write to an external system.",
  tier: "team",
  ownerId: "usr_reviewer",
  version: "1.0.0",
  status: "published",
  permissions: ["slack:write"],
  dependencies: [],
  requiredTools: [],
  adapterTargets: ["generic-mcp"],
  updatedAt: "2026-06-01T00:00:00.000Z",
  toolType: "connector",
  inputSchema: {},
  rateLimit: "60/min",
  secrets: [],
  auditPolicy: "log-metadata"
};

describe("policy", () => {
  it("orders authority tiers by promotion rank", () => {
    expect(isTierAtLeast("company-main", "team")).toBe(true);
    expect(isTierAtLeast("team", "company-main")).toBe(false);
  });

  it("allows atom reads only when tier, role, and team ACLs match", () => {
    expect(canReadAtom(reviewer, atom)).toEqual({
      allowed: true,
      reason: "Allowed by tier, role, and team ACL."
    });

    expect(canReadAtom({ ...reviewer, teams: ["sales"] }, atom).allowed).toBe(false);
    expect(canReadAtom({ ...reviewer, role: "agent" }, { ...atom, acl: { ...atom.acl, roles: ["reviewer"] } }).allowed).toBe(false);
  });

  it("hides write-capable registry items from employees", () => {
    expect(canDiscoverRegistryItem(employee, writeTool).allowed).toBe(false);
    expect(canDiscoverRegistryItem(reviewer, writeTool).allowed).toBe(true);
  });

  it("blocks changeset merge when checks fail or remain pending", () => {
    expect(
      enforceChangesetMerge([
        { label: "Owner", status: "passed" },
        { label: "Source evidence", status: "failed" },
        { label: "Security scan", status: "pending" }
      ])
    ).toEqual({
      allowed: false,
      reasons: ["Source evidence failed"]
    });

    expect(enforceChangesetMerge([{ label: "Owner", status: "passed" }])).toEqual({
      allowed: true,
      reasons: ["All required checks passed."]
    });
  });
});

