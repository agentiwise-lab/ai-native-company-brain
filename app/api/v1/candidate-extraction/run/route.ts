import { NextResponse } from "next/server";
import { z } from "zod";
import { candidateExtractionWorker } from "@/lib/candidate-extraction";
import { composioIngestionPipeline } from "@/lib/composio-ingestion";

const runSchema = z.object({
  artifactIds: z.array(z.string().min(1)).optional(),
  principalId: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Candidate extraction failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = runSchema.parse(await request.json());
    const ingestion = await composioIngestionPipeline.getState();
    return NextResponse.json(
      await candidateExtractionWorker.run({
        artifactIds: body.artifactIds,
        principalId: body.principalId,
        artifacts: ingestion.artifacts
      }),
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
