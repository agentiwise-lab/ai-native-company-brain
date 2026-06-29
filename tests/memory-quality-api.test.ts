import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

function jsonRequest(path: string, body: unknown = {}) {
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

async function importIsolatedRoutes() {
  const dir = mkdtempSync(join(tmpdir(), "company-brain-quality-api-"));
  process.env.MEMORY_QUALITY_STATE_PATH = join(dir, "quality.json");
  process.env.MEMORY_CONFLICT_STATE_PATH = join(dir, "conflicts.json");
  process.env.COMPANY_BRAIN_REPOSITORY = "seed";
  vi.resetModules();

  const [run, resolve] = await Promise.all([
    import("../app/api/v1/memory-quality/run/route"),
    import("../app/api/v1/memory-quality/[id]/resolve/route")
  ]);

  return {
    run: run.POST,
    resolve: resolve.POST
  };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("memory quality API", () => {
  it("scores dashboard atoms and records a reviewer resolution", async () => {
    const routes = await importIsolatedRoutes();
    const runResponse = await routes.run();
    const run = await runResponse.json();

    expect(runResponse.status).toBe(201);
    expect(run.scores.length).toBeGreaterThan(0);
    expect(run.queue.length).toBeGreaterThan(0);

    const resolveResponse = await routes.resolve(
      jsonRequest(`/api/v1/memory-quality/${run.queue[0].id}/resolve`, {
        reviewerId: "usr_reviewer",
        action: run.queue[0].recommendedAction,
        note: "Reviewed from API test."
      }),
      params(run.queue[0].id)
    );
    const resolution = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolution.item.status).toBe("resolved");
    expect(resolution.auditEvent).toMatchObject({
      action: "review",
      metadata: expect.objectContaining({
        atomId: run.queue[0].atomId
      })
    });
  });
});
