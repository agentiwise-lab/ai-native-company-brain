import { NextResponse } from "next/server";
import { z } from "zod";
import { memoryConflictWorkflow } from "@/lib/memory-conflicts";
import { repository } from "@/lib/repository";

const resolveSchema = z.object({
  reviewerId: z.string().default("usr_reviewer"),
  action: z.enum(["merge-duplicate", "supersede-stale", "reject-candidate", "request-evidence", "dismiss-false-positive"]),
  note: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Memory conflict resolution failed" }, { status: 400 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, body] = await Promise.all([context.params, request.json()]);
    const parsed = resolveSchema.parse(body);
    const reviewer = await repository.principal(parsed.reviewerId);
    return NextResponse.json(
      await memoryConflictWorkflow.resolve({
        conflictId: id,
        reviewer,
        action: parsed.action,
        note: parsed.note
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
