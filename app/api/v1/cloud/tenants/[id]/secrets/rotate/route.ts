import { NextResponse } from "next/server";
import { z } from "zod";
import { cloudControlPlane } from "@/lib/cloud-control-plane";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  secretName: z.enum(["DATABASE_URL", "REDIS_URL", "COMPOSIO_API_KEY", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = schema.parse(await request.json());
  return NextResponse.json(
    await cloudControlPlane.rotateSecret({
      principal: resolvePrincipal(body.principal, body.principalId),
      tenantId: id,
      secretName: body.secretName
    })
  );
}
