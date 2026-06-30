import { NextResponse } from "next/server";
import { connectorMaintenanceAssistant } from "@/lib/connector-maintenance";

export async function GET() {
  return NextResponse.json(await connectorMaintenanceAssistant.getState());
}
