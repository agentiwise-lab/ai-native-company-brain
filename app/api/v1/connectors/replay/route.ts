import { NextResponse } from "next/server";
import { z } from "zod";
import { connectorOps } from "@/lib/connector-ops";

const replaySchema = z.object({
  connector: z.string().min(1),
  connectedAccountId: z.string().min(1),
  sourceObjectId: z.string().min(1)
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Connector replay failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = replaySchema.parse(await request.json());
    return NextResponse.json(await connectorOps.replay(body));
  } catch (error) {
    return errorResponse(error);
  }
}
