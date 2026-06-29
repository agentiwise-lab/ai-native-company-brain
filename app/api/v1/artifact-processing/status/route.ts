import { NextResponse } from "next/server";
import { artifactProcessingPipeline } from "@/lib/artifact-processing";

export async function GET() {
  return NextResponse.json(await artifactProcessingPipeline.getState());
}
