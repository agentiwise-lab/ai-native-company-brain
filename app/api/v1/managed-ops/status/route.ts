import { NextResponse } from "next/server";
import { managedOpsService } from "@/lib/managed-ops";

export async function GET() {
  return NextResponse.json(await managedOpsService.getState());
}
