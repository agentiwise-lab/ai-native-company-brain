import { NextResponse } from "next/server";
import { z } from "zod";
import { registryPublicationPipeline } from "@/lib/registry-publication";

const publishSchema = z.object({
  item: z.unknown(),
  changeset: z.unknown(),
  reviewerId: z.string().optional(),
  sandboxPassed: z.boolean().optional(),
  evalsPassed: z.boolean().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Registry publication failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = publishSchema.parse(await request.json());
    return NextResponse.json(
      await registryPublicationPipeline.publish({
        item: body.item as never,
        changeset: body.changeset as never,
        reviewerId: body.reviewerId,
        sandboxPassed: body.sandboxPassed,
        evalsPassed: body.evalsPassed
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
