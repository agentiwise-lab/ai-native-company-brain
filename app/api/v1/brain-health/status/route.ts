import { NextResponse } from "next/server";
import { brainHealthAgent } from "@/lib/brain-health-agent";

export async function GET() {
  return NextResponse.json(await brainHealthAgent.getState());
}
