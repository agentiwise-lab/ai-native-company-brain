import { NextResponse } from "next/server";
import { composioControlPlane } from "@/lib/composio-control-plane";

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Composio account reauthorize failed" }, { status: 400 });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await composioControlPlane.reauthorizeConnectedAccount(id));
  } catch (error) {
    return errorResponse(error);
  }
}
