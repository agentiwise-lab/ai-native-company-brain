import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { messageForBrainError, resolveBrainRequestContext, statusForBrainError } from "@/lib/request-context";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "request-changes"]),
  note: z.string().optional(),
  editedTitle: z.string().min(1).optional(),
  editedBody: z.string().min(1).optional()
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = reviewSchema.parse(await request.json());
    const requestContext = resolveBrainRequestContext(request);
    return NextResponse.json(
      await repository.reviewMemoryChangeset({
        changesetId: id,
        reviewerId: requestContext.principalId,
        ...body
      })
    );
  } catch (error) {
    return NextResponse.json({ error: messageForBrainError(error) }, { status: statusForBrainError(error) });
  }
}
