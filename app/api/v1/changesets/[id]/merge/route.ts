import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { brainTiers } from "@/lib/types";
import { messageForBrainError, resolveBrainRequestContext, statusForBrainError } from "@/lib/request-context";

const mergeSchema = z.object({
  targetTier: z.enum(brainTiers).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = mergeSchema.parse(await request.json().catch(() => ({})));
    const requestContext = resolveBrainRequestContext(request);
    const result = await repository.mergeMemoryChangeset({
      changesetId: id,
      reviewerId: requestContext.principalId,
      targetTier: body.targetTier
    });

    return NextResponse.json(result, { status: result.decision.allowed ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: messageForBrainError(error) }, { status: statusForBrainError(error) });
  }
}
