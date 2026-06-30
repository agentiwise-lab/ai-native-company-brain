import { NextResponse } from "next/server";
import { z } from "zod";
import { operabilityService } from "@/lib/operability";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  migrationId: z.string(),
  failedStep: z.string(),
  error: z.string(),
  backupId: z.string().optional(),
  connectorCheckpointIds: z.array(z.string()).optional()
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
    await operabilityService.recordMigrationFailure({
      principal: resolvePrincipal(body.principal, body.principalId),
      migrationId: body.migrationId,
      failedStep: body.failedStep,
      error: body.error,
      backupId: body.backupId,
      connectorCheckpointIds: body.connectorCheckpointIds
    })
  );
}
