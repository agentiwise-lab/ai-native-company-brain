import { NextResponse } from "next/server";
import { packageDistributionService, resolveDistributionPrincipal } from "@/lib/package-distribution";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const principal = resolveDistributionPrincipal(url.searchParams.get("principalId") ?? undefined);
  return NextResponse.json(await packageDistributionService.listCatalog({ principal }));
}
