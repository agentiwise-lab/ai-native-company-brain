import { describe, expect, it } from "vitest";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe("brain API", () => {
  it("returns accessible citations with quality metadata", async () => {
    const response = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: "promotion",
        principalId: "usr_admin"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.citations.length).toBeGreaterThan(0);
    expect(payload.citations[0]).toMatchObject({
      tier: "company-main",
      freshness: expect.any(Number),
      confidence: expect.any(Number),
      status: "approved"
    });
  });

  it("returns an empty result for a no-match query", async () => {
    const response = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: "definitely-not-a-real-company-brain-memory",
        principalId: "usr_admin"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.citations).toHaveLength(0);
    expect(payload.answer).toMatch(/no accessible memory/i);
  });

  it("rejects forbidden or unknown principals", async () => {
    const response = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: "promotion",
        principalId: "usr_missing"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/principal/i);
  });

  it("commits candidate atoms with source metadata, changeset, and audit event", async () => {
    const response = await commitBrain(
      jsonRequest("/api/v1/brain/commit", {
        title: "Documented onboarding exception",
        body: "The implementation team can request an onboarding exception when the source playbook says so.",
        tier: "team",
        principalId: "usr_admin",
        sourceIds: ["src_002"],
        sourceUri: "https://docs.example.com/revenue/onboarding#exception",
        sourceTitle: "Revenue onboarding playbook"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.atom).toMatchObject({
      status: "candidate",
      sourceIds: ["src_002"]
    });
    expect(payload.changeset).toMatchObject({
      targetType: "atom",
      targetId: payload.atom.id,
      status: "review"
    });
    expect(payload.event).toMatchObject({
      action: "changeset.open",
      targetType: "changeset",
      metadata: {
        sourceUri: "https://docs.example.com/revenue/onboarding#exception",
        sourceTitle: "Revenue onboarding playbook"
      }
    });
  });
});
