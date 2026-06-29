import { NextResponse } from "next/server";
import { z } from "zod";
import { composioControlPlane } from "@/lib/composio-control-plane";

const configSchema = z.object({
  projectId: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  apiKeyConfigured: z.boolean().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Composio request failed" }, { status: 400 });
}

export async function GET() {
  const state = await composioControlPlane.getState();
  return NextResponse.json({
    config: state.config,
    connectedAccounts: state.connectedAccounts.length,
    sessions: state.sessions.length,
    registryCandidates: state.registryCandidates.length,
    recentEvents: state.auditEvents.slice(0, 10)
  });
}

export async function POST(request: Request) {
  try {
    const body = configSchema.parse(await request.json());
    return NextResponse.json(await composioControlPlane.configure(body));
  } catch (error) {
    return errorResponse(error);
  }
}
