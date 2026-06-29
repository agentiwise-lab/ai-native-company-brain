import { NextResponse } from "next/server";
import { z } from "zod";
import { composioControlPlane } from "@/lib/composio-control-plane";

const accountSchema = z.object({
  toolkitSlug: z.string().min(1),
  authConfigId: z.string().min(1),
  principalId: z.string().min(1)
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Composio account request failed" }, { status: 400 });
}

export async function GET() {
  const state = await composioControlPlane.getState();
  return NextResponse.json(state.connectedAccounts);
}

export async function POST(request: Request) {
  try {
    const body = accountSchema.parse(await request.json());
    return NextResponse.json(await composioControlPlane.initiateConnectedAccount(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
