import { NextResponse } from "next/server";
import { z } from "zod";
import { createPackageDistributionService, resolveDistributionPrincipal } from "@/lib/package-distribution";

const rollbackSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  packageId: z.string(),
  fromVersion: z.string(),
  targetVersion: z.string(),
  registryItems: z.array(z.unknown()).optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Package rollback failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = rollbackSchema.parse(await request.json());
    const service = createPackageDistributionService(
      body.registryItems
        ? {
            registryItems: body.registryItems as never
          }
        : {}
    );
    return NextResponse.json(
      await service.rollbackPackage({
        principal: resolveDistributionPrincipal((body.principal as never) ?? body.principalId),
        packageId: body.packageId,
        fromVersion: body.fromVersion,
        targetVersion: body.targetVersion
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
