import { NextResponse } from "next/server";
import { z } from "zod";
import { marketplaceService, resolveMarketplacePrincipal } from "@/lib/marketplace";

const rollbackSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  installId: z.string(),
  reason: z.string().min(1)
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Marketplace rollback failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = rollbackSchema.parse(await request.json());
    return NextResponse.json(
      await marketplaceService.rollbackInstall({
        principal: resolveMarketplacePrincipal((body.principal as never) ?? body.principalId),
        installId: body.installId,
        reason: body.reason
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
