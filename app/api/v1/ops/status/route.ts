import { NextResponse } from "next/server";
import { operabilityService } from "@/lib/operability";

export async function GET() {
  return NextResponse.json(await operabilityService.getState());
}
