import { NextResponse } from "next/server";
import { managedOpsService } from "@/lib/managed-ops";
import { principals } from "@/lib/seed";

function resolvePrincipal(principalId?: string | null) {
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  const principalId = new URL(request.url).searchParams.get("principalId");
  return NextResponse.json(await managedOpsService.supportView({ principal: resolvePrincipal(principalId), tenantId }));
}
