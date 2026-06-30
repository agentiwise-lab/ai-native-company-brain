import { NextResponse } from "next/server";
import { complianceWorkflows } from "@/lib/compliance-workflows";

export async function GET() {
  return NextResponse.json(await complianceWorkflows.getState());
}
