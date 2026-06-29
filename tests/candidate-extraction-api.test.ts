import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-principal-id": "usr_admin",
      "x-tenant-id": "tenant_demo"
    },
    body: JSON.stringify(body)
  });
}

async function importIsolatedRoutes() {
  const dir = mkdtempSync(join(tmpdir(), "company-brain-extraction-api-"));
  process.env.COMPOSIO_INGESTION_STATE_PATH = join(dir, "ingestion.json");
  process.env.ARTIFACT_PROCESSING_STATE_PATH = join(dir, "processing.json");
  process.env.CANDIDATE_EXTRACTION_STATE_PATH = join(dir, "extraction.json");
  process.env.COMPANY_BRAIN_REPOSITORY = "seed";
  vi.resetModules();

  const [ingestion, processing, extractionRun, extractionStatus, review] = await Promise.all([
    import("../app/api/v1/ingestion/composio/route"),
    import("../app/api/v1/artifact-processing/process/route"),
    import("../app/api/v1/candidate-extraction/run/route"),
    import("../app/api/v1/candidate-extraction/status/route"),
    import("../app/api/v1/changesets/[id]/review/route")
  ]);

  return {
    ingestArtifact: ingestion.POST,
    processArtifact: processing.POST,
    runExtraction: extractionRun.POST,
    extractionStatus: extractionStatus.GET,
    reviewChangeset: review.PATCH
  };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("candidate extraction API", () => {
  it("runs ingestion, processing, extraction, status, and review edit end to end", async () => {
    const routes = await importIsolatedRoutes();
    const ingestResponse = await routes.ingestArtifact(
      jsonRequest("/api/v1/ingestion/composio", {
        connector: "slack",
        sourceType: "slack",
        sourceObjectId: "slack:T123:C123:thread_1",
        sourceUpdatedAt: "2026-06-29T10:00:00.000Z",
        principalId: "usr_admin",
        connectedAccount: {
          id: "acct_slack",
          status: "active",
          principalId: "usr_admin"
        },
        provenanceUrl: "https://slack.example.com/archives/C123/p1",
        title: "Slack connector decision",
        normalizedText: "Decision: the platform team approved weekly connector review using Composio source evidence.",
        raw: { mimeType: "text/plain" },
        acl: {
          teams: ["platform"],
          roles: ["admin", "reviewer", "operator", "agent"],
          sensitivity: "internal"
        },
        checkpoint: { cursor: "cursor_1" }
      })
    );
    const ingested = await ingestResponse.json();
    expect(ingestResponse.status).toBe(201);

    const processResponse = await routes.processArtifact(
      jsonRequest("/api/v1/artifact-processing/process", {
        artifactId: ingested.artifact.id
      })
    );
    expect(processResponse.status).toBe(201);

    const extractionResponse = await routes.runExtraction(
      jsonRequest("/api/v1/candidate-extraction/run", {
        artifactIds: [ingested.artifact.id],
        principalId: "usr_admin"
      })
    );
    const extraction = await extractionResponse.json();
    expect(extractionResponse.status).toBe(201);
    expect(extraction.run).toMatchObject({
      status: "completed",
      candidateCount: 1
    });
    expect(extraction.candidates[0].atom).toMatchObject({
      atomType: "decision",
      status: "candidate",
      sourceIds: [ingested.artifact.id]
    });

    const statusResponse = await routes.extractionStatus();
    const status = await statusResponse.json();
    expect(status.candidates).toHaveLength(1);

    const reviewResponse = await routes.reviewChangeset(
      jsonRequest(`/api/v1/changesets/${extraction.candidates[0].changeset.id}/review`, {
        action: "request-changes",
        note: "Clarify the candidate before merge.",
        editedTitle: "Weekly connector review decision",
        editedBody: "The platform team approved weekly connector review using Composio source evidence."
      }),
      params(extraction.candidates[0].changeset.id)
    );
    const reviewed = await reviewResponse.json();
    expect(reviewResponse.status).toBe(200);
    expect(reviewed.atom).toMatchObject({
      title: "Weekly connector review decision",
      body: "The platform team approved weekly connector review using Composio source evidence."
    });
  });
});
