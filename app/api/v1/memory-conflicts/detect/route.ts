import { NextResponse } from "next/server";
import { z } from "zod";
import { candidateExtractionWorker } from "@/lib/candidate-extraction";
import { memoryConflictWorkflow } from "@/lib/memory-conflicts";
import { repository } from "@/lib/repository";

const detectSchema = z.object({
  principalId: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Memory conflict detection failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = detectSchema.parse(await request.json());
    const [principal, snapshot, extraction] = await Promise.all([
      repository.principal(body.principalId),
      repository.dashboard(),
      candidateExtractionWorker.getState()
    ]);
    const candidateIds = new Set(extraction.candidates.map((candidate) => candidate.atom.id));
    return NextResponse.json(
      await memoryConflictWorkflow.detect({
        principal,
        candidates: extraction.candidates.map((candidate) => candidate.atom),
        existing: snapshot.atoms.filter((atom) => !candidateIds.has(atom.id))
      }),
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
