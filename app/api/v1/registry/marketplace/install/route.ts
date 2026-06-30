import { NextResponse } from "next/server";
import { z } from "zod";
import { createMarketplaceService, resolveMarketplacePrincipal } from "@/lib/marketplace";

const installSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  packageId: z.string(),
  targetTier: z.enum(["individual", "team", "department", "company-main", "exec-protected", "regulated"]),
  includeDependencies: z.boolean().optional(),
  registryItems: z.array(z.unknown()).optional(),
  publicPackages: z.array(z.unknown()).optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Marketplace package install failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = installSchema.parse(await request.json());
    const service =
      body.registryItems || body.publicPackages
        ? createMarketplaceService({
            registryItems: body.registryItems as never,
            publicPackages: body.publicPackages as never
          })
        : createMarketplaceService();
    return NextResponse.json(
      await service.installPackage({
        principal: resolveMarketplacePrincipal((body.principal as never) ?? body.principalId),
        packageId: body.packageId,
        targetTier: body.targetTier,
        includeDependencies: body.includeDependencies
      }),
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
