import { describe, expect, it } from "vitest";
import { createPostgresRepository, type SqlClient } from "../lib/postgres-repository";
import type { BrainEvent, Changeset, KnowledgeAtom, Principal, RegistryItem } from "../lib/types";

type QueryCall = {
  sql: string;
  params: unknown[];
};

class FakeSqlClient implements SqlClient {
  calls: QueryCall[] = [];
  shouldFailOnAtomInsert = false;
  atoms: KnowledgeAtom[] = [];
  changesets: Changeset[] = [];
  events: BrainEvent[] = [];
  principals: Principal[] = [
    {
      id: "usr_admin",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      teams: ["platform"],
      tiers: ["individual", "team", "department", "company-main"],
      scopes: ["brain:read", "brain:write"]
    }
  ];
  registry: RegistryItem[] = [];

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return { rows: [] };
    }

    if (normalized.includes("from principals")) {
      return { rows: this.principals as T[] };
    }

    if (normalized.includes("from knowledge_atoms")) {
      return { rows: this.atoms as T[] };
    }

    if (normalized.includes("from registry_items")) {
      return { rows: this.registry as T[] };
    }

    if (normalized.includes("from changesets")) {
      return { rows: this.changesets as T[] };
    }

    if (normalized.includes("from brain_events")) {
      return { rows: this.events as T[] };
    }

    if (normalized.startsWith("insert into knowledge_atoms")) {
      if (this.shouldFailOnAtomInsert) {
        throw new Error("atom insert failed");
      }
      const [
        id,
        tenantId,
        title,
        body,
        atomType,
        tier,
        ownerId,
        sourceIds,
        acl,
        status,
        version,
        confidence,
        freshness,
        reviewDueAt,
        tags,
        createdAt,
        updatedAt
      ] = params;
      this.atoms.push({
        id,
        tenantId,
        title,
        body,
        atomType,
        tier,
        ownerId,
        sourceIds,
        acl: JSON.parse(String(acl)),
        status,
        version,
        confidence,
        freshness,
        reviewDueAt,
        tags,
        createdAt,
        updatedAt
      } as KnowledgeAtom);
      return { rows: [] };
    }

    if (normalized.startsWith("insert into changesets")) {
      const [
        id,
        tenantId,
        title,
        targetType,
        targetId,
        tier,
        authorId,
        ownerId,
        reviewers,
        status,
        summary,
        checks,
        createdAt,
        updatedAt
      ] = params;
      this.changesets.push({
        id,
        tenantId,
        title,
        targetType,
        targetId,
        tier,
        authorId,
        ownerId,
        reviewers,
        status,
        summary,
        checks: JSON.parse(String(checks)),
        createdAt,
        updatedAt
      } as Changeset);
      return { rows: [] };
    }

    if (normalized.startsWith("insert into brain_events")) {
      const [id, tenantId, actorId, action, targetId, targetType, policyDecision, metadata, createdAt] = params;
      this.events.push({
        id,
        tenantId,
        actorId,
        action,
        targetId,
        targetType,
        policyDecision,
        metadata: JSON.parse(String(metadata)),
        createdAt
      } as BrainEvent);
      return { rows: [] };
    }

    return { rows: [] };
  }
}

describe("Postgres repository", () => {
  it("tenant-scopes reads through parameterized SQL", async () => {
    const client = new FakeSqlClient();
    const repository = createPostgresRepository({ client, tenantId: "tenant_a" });

    await repository.queryBrain("anything", "usr_admin");

    expect(client.calls.some((call) => call.sql.includes("tenant_id = $1") && call.params[0] === "tenant_a")).toBe(true);
  });

  it("writes atom, changeset, and event in one transaction", async () => {
    const client = new FakeSqlClient();
    const repository = createPostgresRepository({
      client,
      tenantId: "tenant_a",
      now: () => "2026-06-29T12:00:00.000Z",
      id: (prefix) => `${prefix}_test`
    });

    const result = await repository.commitBrain({
      title: "Persisted atom",
      body: "This is stored through the repository.",
      tier: "team",
      principalId: "usr_admin"
    });

    expect(result.atom.tenantId).toBe("tenant_a");
    expect(result.changeset.tenantId).toBe("tenant_a");
    expect(client.events).toHaveLength(1);
    expect(client.events[0]).toMatchObject({
      tenantId: "tenant_a",
      action: "changeset.open",
      targetType: "changeset"
    });
    expect(client.calls.map((call) => call.sql.toLowerCase())).toEqual(
      expect.arrayContaining(["begin", "commit"])
    );
  });

  it("rolls back transaction when a mutation fails", async () => {
    const client = new FakeSqlClient();
    client.shouldFailOnAtomInsert = true;
    const repository = createPostgresRepository({ client, tenantId: "tenant_a" });

    await expect(
      repository.commitBrain({
        title: "Broken atom",
        body: "This should rollback.",
        principalId: "usr_admin"
      })
    ).rejects.toThrow(/atom insert failed/i);

    expect(client.calls.map((call) => call.sql.toLowerCase())).toEqual(
      expect.arrayContaining(["begin", "rollback"])
    );
    expect(client.changesets).toHaveLength(0);
    expect(client.events).toHaveLength(0);
  });
});
