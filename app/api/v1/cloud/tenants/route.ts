import { NextResponse } from "next/server";
import { z } from "zod";
import { cloudControlPlane } from "@/lib/cloud-control-plane";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  tenantName: z.string(),
  adminName: z.string(),
  adminEmail: z.string(),
  region: z.string(),
  plan: z.enum(["team", "business", "enterprise"]),
  composioProjectId: z.string(),
  composioApiKeyConfigured: z.boolean()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function GET() {
  return NextResponse.json(await cloudControlPlane.getState());
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  return NextResponse.json(
    await cloudControlPlane.provisionTenant({
      principal: resolvePrincipal(body.principal, body.principalId),
      tenantName: body.tenantName,
      adminName: body.adminName,
      adminEmail: body.adminEmail,
      region: body.region,
      plan: body.plan,
      composioProjectId: body.composioProjectId,
      composioApiKeyConfigured: body.composioApiKeyConfigured
    })
  );
}
