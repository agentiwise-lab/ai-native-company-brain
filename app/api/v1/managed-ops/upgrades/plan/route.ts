import { NextResponse } from "next/server";
import { z } from "zod";
import { managedOpsService } from "@/lib/managed-ops";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  tenantId: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  connectorCheckpoints: z.array(z.string()).default([]),
  cronSchedules: z.array(z.string()).default([]),
  packageVersions: z.array(z.string()).default([])
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
    await managedOpsService.planUpgrade({
      principal: resolvePrincipal(body.principal, body.principalId),
      tenantId: body.tenantId,
      fromVersion: body.fromVersion,
      toVersion: body.toVersion,
      connectorCheckpoints: body.connectorCheckpoints,
      cronSchedules: body.cronSchedules,
      packageVersions: body.packageVersions
    })
  );
}
