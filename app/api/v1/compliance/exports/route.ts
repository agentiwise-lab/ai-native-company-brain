import { NextResponse } from "next/server";
import { z } from "zod";
import { complianceWorkflows } from "@/lib/compliance-workflows";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  scope: z.enum(["individual", "organization"]),
  subjectPrincipalId: z.string().optional(),
  includeRestricted: z.boolean().optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  return NextResponse.json(
    await complianceWorkflows.exportMemory({
      principal: resolvePrincipal(body.principal, body.principalId),
      scope: body.scope,
      subjectPrincipalId: body.subjectPrincipalId,
      includeRestricted: body.includeRestricted
    })
  );
}
