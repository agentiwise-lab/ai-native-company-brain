import { NextResponse } from "next/server";
import { z } from "zod";
import { durableScheduler } from "@/lib/durable-scheduler";
import { principals } from "@/lib/seed";

const executeSchema = z.object({
  workerId: z.string().optional(),
  principal: z.unknown().optional(),
  principalId: z.string().optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = executeSchema.parse(await request.json());
  const state = await durableScheduler.getState();
  const workerId = body.workerId ?? state.leases.find((lease) => lease.id === id)?.workerId ?? "worker_default";
  const result = await durableScheduler.executeLease({
    leaseId: id,
    workerId,
    principal: resolvePrincipal(body.principal, body.principalId)
  });
  return NextResponse.json(result, { status: result.run.status === "needs-approval" ? 202 : 200 });
}
