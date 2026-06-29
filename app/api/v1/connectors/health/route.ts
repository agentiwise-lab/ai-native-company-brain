import { NextResponse } from "next/server";
import { connectorOps } from "@/lib/connector-ops";

export async function GET() {
  return NextResponse.json(await connectorOps.health());
}
