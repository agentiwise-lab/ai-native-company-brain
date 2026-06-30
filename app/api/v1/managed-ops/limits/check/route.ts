import { NextResponse } from "next/server";
import { z } from "zod";
import { managedOpsService } from "@/lib/managed-ops";
import { principals } from "@/lib/seed";

const measurements = z.object({
  connectorSyncs: z.number().nonnegative().optional(),
  composioActions: z.number().nonnegative().optional(),
  toolInvocations: z.number().nonnegative().optional(),
  storageBytes: z.number().nonnegative().optional(),
  queryCount: z.number().nonnegative().optional(),
  cronRuns: z.number().nonnegative().optional(),
  workerMs: z.number().nonnegative().optional()
});

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  tenantId: z.string(),
  plan: z.enum(["team", "business", "enterprise"]).optional(),
  requested: measurements
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
    await managedOpsService.enforcePlanLimit({
      principal: resolvePrincipal(body.principal, body.principalId),
      tenantId: body.tenantId,
      plan: body.plan,
      requested: body.requested
    })
  );
}
