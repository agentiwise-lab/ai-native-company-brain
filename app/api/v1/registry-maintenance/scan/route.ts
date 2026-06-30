import { NextResponse } from "next/server";
import { z } from "zod";
import { createRegistryMaintenanceAgent, registryMaintenanceAgent } from "@/lib/registry-maintenance-agent";
import { principals } from "@/lib/seed";

const scanSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  registryItems: z.array(z.unknown()).optional(),
  dependencyChanges: z.array(z.object({ dependencyId: z.string(), changeType: z.string() })).optional(),
  policyChanges: z.array(z.object({ atomId: z.string(), policyType: z.string() })).optional(),
  composioChanges: z.array(z.object({ toolkitSlug: z.string(), removedActions: z.array(z.string()) })).optional(),
  evalScores: z.record(z.number()).optional(),
  usage: z.record(z.object({ current: z.number(), previous: z.number() })).optional(),
  rollbackRisk: z.record(z.number()).optional(),
  requireApprovalForRisky: z.boolean().optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = scanSchema.parse(await request.json());
  const service = body.registryItems ? createRegistryMaintenanceAgent({ registryItems: body.registryItems as never }) : registryMaintenanceAgent;
  return NextResponse.json(
    await service.scan({
      principal: resolvePrincipal(body.principal, body.principalId),
      dependencyChanges: body.dependencyChanges,
      policyChanges: body.policyChanges,
      composioChanges: body.composioChanges,
      evalScores: body.evalScores,
      usage: body.usage,
      rollbackRisk: body.rollbackRisk,
      requireApprovalForRisky: body.requireApprovalForRisky
    })
  );
}
