import { NextResponse } from "next/server";
import { z } from "zod";
import { registryPublicationPipeline } from "@/lib/registry-publication";

const checkSchema = z.object({
  item: z.unknown(),
  changeset: z.unknown(),
  reviewerId: z.string().optional(),
  sandboxPassed: z.boolean().optional(),
  evalsPassed: z.boolean().optional()
});

export async function POST(request: Request) {
  const body = checkSchema.parse(await request.json());
  return NextResponse.json(
    await registryPublicationPipeline.evaluate({
      item: body.item as never,
      changeset: body.changeset as never,
      reviewerId: body.reviewerId,
      sandboxPassed: body.sandboxPassed,
      evalsPassed: body.evalsPassed
    })
  );
}
