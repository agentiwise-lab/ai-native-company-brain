import { NextResponse } from "next/server";
import { z } from "zod";
import { createConnectorMaintenanceAssistant, connectorMaintenanceAssistant } from "@/lib/connector-maintenance";
import { principals } from "@/lib/seed";

const offboardingSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  controlState: z.unknown().optional(),
  ingestionState: z.unknown().optional(),
  knowledgeAtoms: z.array(z.unknown()).optional(),
  subjectPrincipalId: z.string(),
  includeRestricted: z.boolean().optional(),
  accountAction: z.enum(["revoke", "remap"]).optional(),
  remapToPrincipalId: z.string().optional(),
  reason: z.string().optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = offboardingSchema.parse(await request.json());
  const service =
    body.controlState || body.ingestionState || body.knowledgeAtoms
      ? createConnectorMaintenanceAssistant({
          controlPlane: body.controlState ? { getState: async () => body.controlState as never } : undefined,
          ingestionPipeline: body.ingestionState ? { getState: async () => body.ingestionState as never } : undefined,
          knowledgeAtoms: body.knowledgeAtoms as never
        })
      : connectorMaintenanceAssistant;

  return NextResponse.json(
    await service.offboard({
      principal: resolvePrincipal(body.principal, body.principalId),
      subjectPrincipalId: body.subjectPrincipalId,
      includeRestricted: body.includeRestricted,
      accountAction: body.accountAction,
      remapToPrincipalId: body.remapToPrincipalId,
      reason: body.reason
    })
  );
}
