import { NextResponse } from "next/server";
import { marketplaceService, resolveMarketplacePrincipal } from "@/lib/marketplace";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? undefined;
  return NextResponse.json(
    await marketplaceService.listMarketplace({
      principal: resolveMarketplacePrincipal(url.searchParams.get("principalId") ?? undefined),
      source: source === "private" || source === "public" || source === "partner" ? source : undefined
    })
  );
}
