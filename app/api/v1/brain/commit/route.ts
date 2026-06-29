import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { brainTiers } from "@/lib/types";
import { messageForBrainError, resolveBrainRequestContext, statusForBrainError } from "@/lib/request-context";

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  tier: z.enum(brainTiers).optional(),
  principalId: z.string().optional(),
  sourceIds: z.array(z.string().min(1)).default([]),
  sourceUri: z.string().url().optional(),
  sourceTitle: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const context = resolveBrainRequestContext(request, body.principalId);
    return NextResponse.json(await repository.commitBrain({ ...body, principalId: context.principalId }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: messageForBrainError(error) }, { status: statusForBrainError(error) });
  }
}
