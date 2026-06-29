import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { brainTiers } from "@/lib/types";
import { messageForBrainError, resolveBrainRequestContext, statusForBrainError } from "@/lib/request-context";

const bodySchema = z.object({
  query: z.string().default(""),
  principalId: z.string().optional(),
  tier: z.enum(brainTiers).optional()
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const context = resolveBrainRequestContext(request, body.principalId);
    return NextResponse.json(await repository.queryBrain(body.query, context.principalId, body.tier));
  } catch (error) {
    return NextResponse.json({ error: messageForBrainError(error) }, { status: statusForBrainError(error) });
  }
}
