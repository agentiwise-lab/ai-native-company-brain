import { NextResponse } from "next/server";
import { enterpriseComposioIngestion } from "@/lib/enterprise-composio-ingestion";

export async function GET() {
  return NextResponse.json(await enterpriseComposioIngestion.syncState());
}
