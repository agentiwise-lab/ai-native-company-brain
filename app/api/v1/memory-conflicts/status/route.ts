import { NextResponse } from "next/server";
import { memoryConflictWorkflow } from "@/lib/memory-conflicts";

export async function GET() {
  return NextResponse.json(await memoryConflictWorkflow.getState());
}
