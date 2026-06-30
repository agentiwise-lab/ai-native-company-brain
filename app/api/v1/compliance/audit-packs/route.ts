import { NextResponse } from "next/server";
import { z } from "zod";
import { complianceWorkflows } from "@/lib/compliance-workflows";
import { principals } from "@/lib/seed";
import { brainTiers } from "@/lib/types";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  query: z.string().default(""),
  requestedTier: z.enum(brainTiers).optional()
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
    await complianceWorkflows.buildAnswerAuditPack({
      principal: resolvePrincipal(body.principal, body.principalId),
      query: body.query,
      requestedTier: body.requestedTier
    })
  );
}
