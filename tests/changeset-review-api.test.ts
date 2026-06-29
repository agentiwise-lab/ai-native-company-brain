import { describe, expect, it } from "vitest";
import { GET as atomLineage } from "../app/api/v1/atoms/[id]/lineage/route";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as mergeChangeset } from "../app/api/v1/changesets/[id]/merge/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-principal-id": "usr_reviewer",
      "x-tenant-id": "tenant_demo"
    },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function commitCandidate(input: { title: string; sourceIds?: string[]; sourceUri?: string }) {
  const response = await commitBrain(
    jsonRequest("/api/v1/brain/commit", {
      title: input.title,
      body: `${input.title} body`,
      tier: "team",
      principalId: "usr_reviewer",
      sourceIds: input.sourceIds ?? [],
      sourceUri: input.sourceUri,
      sourceTitle: input.sourceUri ? `${input.title} source` : undefined
    })
  );
  expect(response.status).toBe(201);
  return response.json();
}

describe("memory changeset review API", () => {
  it("approves and merges a source-backed candidate with audit lineage", async () => {
    const committed = await commitCandidate({
      title: "Mergeable customer handoff note",
      sourceIds: ["src_001"],
      sourceUri: "https://docs.example.com/customer-handoff"
    });

    const reviewResponse = await reviewChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/review`, {
        action: "approve",
        note: "Evidence is sufficient."
      }, "PATCH"),
      params(committed.changeset.id)
    );
    const reviewed = await reviewResponse.json();
    expect(reviewResponse.status).toBe(200);
    expect(reviewed.changeset.status).toBe("approved");

    const mergeResponse = await mergeChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/merge`, {}),
      params(committed.changeset.id)
    );
    const merged = await mergeResponse.json();
    expect(mergeResponse.status).toBe(200);
    expect(merged.atom).toMatchObject({ id: committed.atom.id, status: "approved", tier: "team" });
    expect(merged.changeset.status).toBe("merged");
    expect(merged.events.map((event: { action: string }) => event.action)).toEqual(["review", "merge"]);

    const lineageResponse = await atomLineage(new Request(`http://localhost/api/v1/atoms/${committed.atom.id}/lineage`), params(committed.atom.id));
    const lineage = await lineageResponse.json();
    expect(lineage.events.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(["review", "merge"]));
  });

  it("rejects a candidate changeset", async () => {
    const committed = await commitCandidate({ title: "Rejected candidate note", sourceIds: ["src_001"] });
    const response = await reviewChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/review`, {
        action: "reject",
        note: "Not accurate enough."
      }, "PATCH"),
      params(committed.changeset.id)
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.atom.status).toBe("rejected");
    expect(payload.changeset.status).toBe("rolled-back");
    expect(payload.event.action).toBe("review");
  });

  it("requests changes and edits candidate content", async () => {
    const committed = await commitCandidate({ title: "Needs rewrite candidate", sourceIds: ["src_001"] });
    const response = await reviewChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/review`, {
        action: "request-changes",
        note: "Tighten the statement.",
        editedTitle: "Rewritten candidate",
        editedBody: "A tighter candidate body."
      }, "PATCH"),
      params(committed.changeset.id)
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.atom).toMatchObject({
      title: "Rewritten candidate",
      body: "A tighter candidate body.",
      status: "candidate"
    });
    expect(payload.changeset.status).toBe("blocked");
  });

  it("blocks merge when required checks fail", async () => {
    const committed = await commitCandidate({ title: "Unsafe unsourced candidate" });
    await reviewChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/review`, {
        action: "approve",
        note: "Attempted approval."
      }, "PATCH"),
      params(committed.changeset.id)
    );

    const response = await mergeChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/merge`, {}),
      params(committed.changeset.id)
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.decision.allowed).toBe(false);
    expect(payload.decision.reasons.join(" ")).toMatch(/source evidence/i);
  });
});
