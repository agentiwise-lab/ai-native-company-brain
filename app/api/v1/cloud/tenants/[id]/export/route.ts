import { NextResponse } from "next/server";
import { cloudControlPlane } from "@/lib/cloud-control-plane";
import { principals } from "@/lib/seed";

function resolvePrincipal(principalId?: string | null) {
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const principalId = new URL(request.url).searchParams.get("principalId");
  return NextResponse.json(await cloudControlPlane.exportForSelfHost({ principal: resolvePrincipal(principalId), tenantId: id }));
}
