import { NextResponse } from "next/server";
import { z } from "zod";
import { createConnectorMaintenanceAssistant, connectorMaintenanceAssistant } from "@/lib/connector-maintenance";
import { principals } from "@/lib/seed";

const triageSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  health: z.unknown().optional(),
  lagThresholdSeconds: z.number().optional(),
  requiredScopes: z.record(z.array(z.string())).optional(),
  observedScopes: z.record(z.array(z.string())).optional(),
  authExpiresAt: z.record(z.string()).optional(),
  repeatedFailureThreshold: z.number().optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = triageSchema.parse(await request.json());
  const service = body.health
    ? createConnectorMaintenanceAssistant({ connectorOps: { health: async () => body.health as never } })
    : connectorMaintenanceAssistant;
  return NextResponse.json(
    await service.triage({
      principal: resolvePrincipal(body.principal, body.principalId),
      lagThresholdSeconds: body.lagThresholdSeconds,
      requiredScopes: body.requiredScopes,
      observedScopes: body.observedScopes,
      authExpiresAt: body.authExpiresAt,
      repeatedFailureThreshold: body.repeatedFailureThreshold
    })
  );
}
