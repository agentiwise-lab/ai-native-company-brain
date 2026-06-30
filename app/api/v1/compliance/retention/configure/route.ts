import { NextResponse } from "next/server";
import { z } from "zod";
import { complianceWorkflows } from "@/lib/compliance-workflows";
import { principals } from "@/lib/seed";
import { brainTiers } from "@/lib/types";

const sourceTypes = ["slack", "email", "docs", "meeting", "ticket", "crm", "code", "agent-transcript"] as const;
const sensitivities = ["public", "internal", "confidential", "restricted"] as const;

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  rules: z.array(
    z.object({
      id: z.string(),
      sourceType: z.enum(sourceTypes).optional(),
      tier: z.enum(brainTiers).optional(),
      sensitivity: z.enum(sensitivities).optional(),
      retentionDays: z.number().int().positive(),
      deletionBehavior: z.enum(["delete", "tombstone", "review"])
    })
  )
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  return NextResponse.json(await complianceWorkflows.configureRetention({ principal: resolvePrincipal(body.principal, body.principalId), rules: body.rules }));
}
