import { NextResponse } from "next/server";
import { candidateExtractionWorker } from "@/lib/candidate-extraction";

export async function GET() {
  return NextResponse.json(await candidateExtractionWorker.getState());
}
