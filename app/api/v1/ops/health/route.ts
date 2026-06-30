import { NextResponse } from "next/server";
import { z } from "zod";
import { operabilityService } from "@/lib/operability";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  queueDepth: z.number().int().nonnegative().default(0),
  queueDepthThreshold: z.number().int().positive().optional(),
  workers: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["app", "worker", "scheduler", "connector"]),
      lastHeartbeatAt: z.string(),
      activeLeases: z.number().int().nonnegative().default(0)
    })
  ).default([]),
  probes: z.object({
    database: z.enum(["ok", "degraded", "down"]).optional(),
    objectStore: z.enum(["ok", "degraded", "down"]).optional(),
    composio: z.enum(["ok", "degraded", "down"]).optional(),
    mcp: z.enum(["ok", "degraded", "down"]).optional()
  }).optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json().catch(() => ({})));
  return NextResponse.json(
    await operabilityService.collectHealth({
      principal: resolvePrincipal(body.principal, body.principalId),
      queueDepth: body.queueDepth,
      queueDepthThreshold: body.queueDepthThreshold,
      workers: body.workers,
      probes: body.probes
    })
  );
}
