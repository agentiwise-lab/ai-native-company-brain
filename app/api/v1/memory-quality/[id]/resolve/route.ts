import { NextResponse } from "next/server";
import { z } from "zod";
import { memoryQualityLoop } from "@/lib/memory-quality-loop";
import { repository } from "@/lib/repository";

const resolveSchema = z.object({
  reviewerId: z.string().default("usr_reviewer"),
  action: z.enum(["refresh", "demote", "supersede", "retire"]),
  note: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Memory quality resolution failed" }, { status: 400 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, body] = await Promise.all([context.params, request.json()]);
    const parsed = resolveSchema.parse(body);
    const reviewer = await repository.principal(parsed.reviewerId);
    return NextResponse.json(
      await memoryQualityLoop.resolve({
        itemId: id,
        reviewer,
        action: parsed.action,
        note: parsed.note
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
