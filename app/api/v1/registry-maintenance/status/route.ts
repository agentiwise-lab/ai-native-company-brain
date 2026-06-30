import { NextResponse } from "next/server";
import { registryMaintenanceAgent } from "@/lib/registry-maintenance-agent";

export async function GET() {
  return NextResponse.json(await registryMaintenanceAgent.getState());
}
