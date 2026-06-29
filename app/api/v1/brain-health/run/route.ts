import { NextResponse } from "next/server";
import { z } from "zod";
import { brainHealthAgent } from "@/lib/brain-health-agent";
import { principals } from "@/lib/seed";

const runSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  atoms: z.array(z.unknown()).default([]),
  qualityScores: z.array(z.unknown()).default([]),
  conflicts: z.array(z.unknown()).default([]),
  sourceHealth: z.record(z.number()).default({}),
  failedQueries: z.record(z.number()).default({})
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = runSchema.parse(await request.json());
  return NextResponse.json(
    await brainHealthAgent.run({
      principal: resolvePrincipal(body.principal, body.principalId),
      atoms: body.atoms as never,
      qualityScores: body.qualityScores as never,
      conflicts: body.conflicts as never,
      sourceHealth: body.sourceHealth,
      failedQueries: body.failedQueries
    })
  );
}
