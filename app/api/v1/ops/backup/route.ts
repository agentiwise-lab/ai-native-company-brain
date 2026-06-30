import { NextResponse } from "next/server";
import { z } from "zod";
import { operabilityService } from "@/lib/operability";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  label: z.string().default("manual")
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json().catch(() => ({})));
  return NextResponse.json(await operabilityService.createBackup({ principal: resolvePrincipal(body.principal, body.principalId), label: body.label }));
}
