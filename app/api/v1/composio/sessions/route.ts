import { NextResponse } from "next/server";
import { z } from "zod";
import { composioControlPlane } from "@/lib/composio-control-plane";

const sessionSchema = z.object({
  principalId: z.string().min(1),
  purpose: z.enum(["interactive-agent", "connector-worker", "cron-job"]),
  toolkitSlugs: z.array(z.string().min(1)).min(1),
  connectedAccountIds: z.array(z.string().min(1)).default([])
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Composio session request failed" }, { status: 400 });
}

export async function GET() {
  const state = await composioControlPlane.getState();
  return NextResponse.json(state.sessions);
}

export async function POST(request: Request) {
  try {
    const body = sessionSchema.parse(await request.json());
    return NextResponse.json(await composioControlPlane.getOrCreateSession(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
