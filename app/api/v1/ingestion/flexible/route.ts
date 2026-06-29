import { NextResponse } from "next/server";
import { z } from "zod";
import { flexibleComposioIngestion } from "@/lib/flexible-composio-ingestion";

const actionSchema = z.object({
  action: z.enum(["disable", "replay"]),
  sourceId: z.string().min(1)
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Flexible ingestion request failed" }, { status: 400 });
}

export async function GET() {
  return NextResponse.json(await flexibleComposioIngestion.syncState());
}

export async function POST(request: Request) {
  try {
    const body = actionSchema.parse(await request.json());
    const state =
      body.action === "disable"
        ? await flexibleComposioIngestion.disableSource(body.sourceId)
        : await flexibleComposioIngestion.replaySource(body.sourceId);
    return NextResponse.json(state);
  } catch (error) {
    return errorResponse(error);
  }
}
