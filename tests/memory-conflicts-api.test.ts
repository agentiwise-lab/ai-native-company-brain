import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-principal-id": "usr_reviewer",
      "x-tenant-id": "tenant_demo"
    },
    body: JSON.stringify(body)
  });
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function importIsolatedRoutes() {
  const dir = mkdtempSync(join(tmpdir(), "company-brain-conflicts-api-"));
  const extractionPath = join(dir, "candidate-extraction.json");
  process.env.CANDIDATE_EXTRACTION_STATE_PATH = extractionPath;
  process.env.MEMORY_CONFLICT_STATE_PATH = join(dir, "memory-conflicts.json");
  process.env.COMPANY_BRAIN_REPOSITORY = "seed";
  writeJson(extractionPath, {
    runs: [],
    candidates: [
      {
        id: "candidate_atom_duplicate",
        runId: "run_1",
        artifactId: "src_001",
        chunkId: "src_001:chunk:0",
        atom: {
          id: "atom_candidate_duplicate",
          tenantId: "tenant_demo",
          title: "Company brain promotion gates",
          body: "Knowledge must pass owner assignment, evidence checks, reviewer approval, and conflict resolution before it can merge into company-main.",
          atomType: "policy",
          tier: "team",
          ownerId: "usr_admin",
          sourceIds: ["src_001"],
          acl: {
            teams: ["platform"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal"
          },
          status: "candidate",
          version: 1,
          confidence: 0.84,
          freshness: 1,
          reviewDueAt: "2026-07-06T10:00:00.000Z",
          createdAt: "2026-06-29T10:00:00.000Z",
          updatedAt: "2026-06-29T10:00:00.000Z",
          tags: ["candidate", "promotion", "source-linked"]
        },
        changeset: {
          id: "cs_candidate_duplicate",
          tenantId: "tenant_demo",
          title: "Promote duplicate",
          targetType: "atom",
          targetId: "atom_candidate_duplicate",
          tier: "team",
          authorId: "usr_admin",
          ownerId: "usr_admin",
          reviewers: ["usr_reviewer"],
          status: "review",
          checks: [],
          summary: "Candidate duplicate.",
          createdAt: "2026-06-29T10:00:00.000Z",
          updatedAt: "2026-06-29T10:00:00.000Z"
        },
        sourceEvidence: {
          artifactId: "src_001",
          chunkId: "src_001:chunk:0",
          offsetStart: 0,
          offsetEnd: 100,
          provenanceUrl: "https://docs.example.com/company-brain",
          excerpt: "Promotion into company-main requires source evidence.",
          checksum: "sha256:test"
        },
        targetTier: "team",
        ownerId: "usr_admin",
        reviewers: ["usr_reviewer"],
        createdAt: "2026-06-29T10:00:00.000Z"
      }
    ]
  });
  vi.resetModules();

  const [detect, resolve] = await Promise.all([
    import("../app/api/v1/memory-conflicts/detect/route"),
    import("../app/api/v1/memory-conflicts/[id]/resolve/route")
  ]);

  return {
    detect: detect.POST,
    resolve: resolve.POST
  };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("memory conflicts API", () => {
  it("detects candidate duplicates from extraction state and records reviewer resolution", async () => {
    const routes = await importIsolatedRoutes();
    const detectResponse = await routes.detect(jsonRequest("/api/v1/memory-conflicts/detect", { principalId: "usr_reviewer" }));
    const detection = await detectResponse.json();

    expect(detectResponse.status).toBe(201);
    expect(detection.conflicts.length).toBeGreaterThan(0);
    expect(detection.conflicts[0]).toMatchObject({
      conflictType: "duplicate",
      recommendedResolution: "merge-duplicate"
    });

    const resolveResponse = await routes.resolve(
      jsonRequest(`/api/v1/memory-conflicts/${detection.conflicts[0].id}/resolve`, {
        reviewerId: "usr_reviewer",
        action: "merge-duplicate",
        note: "Merge candidate into existing company-main policy."
      }),
      params(detection.conflicts[0].id)
    );
    const resolution = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolution.conflict.status).toBe("resolved");
    expect(resolution.auditEvent).toMatchObject({
      action: "review",
      metadata: expect.objectContaining({
        action: "merge-duplicate"
      })
    });
  });
});
