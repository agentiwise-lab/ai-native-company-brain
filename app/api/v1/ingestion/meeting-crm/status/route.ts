import { NextResponse } from "next/server";
import { meetingCrmComposioIngestion } from "@/lib/meeting-crm-composio-ingestion";

export async function GET() {
  return NextResponse.json(await meetingCrmComposioIngestion.syncState());
}
