import { NextResponse } from "next/server";
import { marketplaceService } from "@/lib/marketplace";

export async function GET() {
  return NextResponse.json(await marketplaceService.getState());
}
