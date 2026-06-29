import { NextResponse } from "next/server";
import { composioIngestionPipeline } from "@/lib/composio-ingestion";

export async function GET() {
  const state = await composioIngestionPipeline.getState();

  return NextResponse.json({
    artifacts: state.artifacts,
    checkpoints: state.checkpoints,
    runs: state.runs,
    auditEvents: state.auditEvents
  });
}
