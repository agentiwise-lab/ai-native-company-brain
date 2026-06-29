import { NextResponse } from "next/server";
import { z } from "zod";
import { createPackageDistributionService, resolveDistributionPrincipal } from "@/lib/package-distribution";

const installSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  packageId: z.string(),
  version: z.string().optional(),
  target: z.enum(["codex", "claude-code", "opencode", "generic-mcp"]),
  registryItems: z.array(z.unknown()).optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Package install failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = installSchema.parse(await request.json());
    const service = createPackageDistributionService(
      body.registryItems
        ? {
            registryItems: body.registryItems as never
          }
        : {}
    );
    return NextResponse.json(
      await service.installPackage({
        principal: resolveDistributionPrincipal((body.principal as never) ?? body.principalId),
        packageId: body.packageId,
        version: body.version,
        target: body.target
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
