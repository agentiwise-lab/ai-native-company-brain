import { NextResponse } from "next/server";
import { z } from "zod";
import { identityOrgSync } from "@/lib/identity-org-sync";
import { principals } from "@/lib/seed";

const schema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  saml: z.object({
    entityId: z.string(),
    ssoUrl: z.string(),
    certificateFingerprint: z.string()
  }),
  scim: z.object({
    baseUrl: z.string(),
    tokenConfigured: z.boolean()
  })
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  return NextResponse.json(await identityOrgSync.configure({ principal: resolvePrincipal(body.principal, body.principalId), saml: body.saml, scim: body.scim }));
}
