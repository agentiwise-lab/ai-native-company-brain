import { NextResponse } from "next/server";
import { z } from "zod";
import { marketplaceService, resolveMarketplacePrincipal } from "@/lib/marketplace";

const reviewSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  packageId: z.string()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Marketplace package review failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = reviewSchema.parse(await request.json());
    return NextResponse.json(
      await marketplaceService.reviewPackage({
        principal: resolveMarketplacePrincipal((body.principal as never) ?? body.principalId),
        packageId: body.packageId
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
