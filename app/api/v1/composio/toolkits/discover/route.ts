import { NextResponse } from "next/server";
import { z } from "zod";
import { composioControlPlane } from "@/lib/composio-control-plane";
import { brainTiers } from "@/lib/types";

const discoverySchema = z.object({
  toolkitSlugs: z.array(z.string().min(1)).min(1),
  ownerId: z.string().min(1),
  tier: z.enum(brainTiers)
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Composio toolkit discovery failed" }, { status: 400 });
}

export async function GET() {
  const state = await composioControlPlane.getState();
  return NextResponse.json(state.registryCandidates);
}

export async function POST(request: Request) {
  try {
    const body = discoverySchema.parse(await request.json());
    return NextResponse.json(await composioControlPlane.discoverToolkitActions(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
