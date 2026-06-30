import { NextResponse } from "next/server";
import { z } from "zod";
import { managedOpsService } from "@/lib/managed-ops";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  tenantId: z.string(),
  workerId: z.string(),
  role: z.enum(["scheduler", "connector", "worker"]),
  error: z.string(),
  checkpointIds: z.array(z.string()).optional(),
  leaseIds: z.array(z.string()).optional()
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
    await managedOpsService.recordWorkerFailure({
      principal: resolvePrincipal(body.principal, body.principalId),
      tenantId: body.tenantId,
      workerId: body.workerId,
      role: body.role,
      error: body.error,
      checkpointIds: body.checkpointIds,
      leaseIds: body.leaseIds
    })
  );
}
