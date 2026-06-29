import { NextResponse } from "next/server";
import { z } from "zod";
import { artifactProcessingPipeline } from "@/lib/artifact-processing";
import { composioIngestionPipeline } from "@/lib/composio-ingestion";

const processSchema = z.object({
  artifactId: z.string().min(1)
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Artifact processing failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = processSchema.parse(await request.json());
    const ingestion = await composioIngestionPipeline.getState();
    const artifact = ingestion.artifacts.find((candidate) => candidate.id === body.artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${body.artifactId} was not found.`);
    }
    return NextResponse.json(await artifactProcessingPipeline.processArtifact(artifact), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
