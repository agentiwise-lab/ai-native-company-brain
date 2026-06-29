import { NextResponse } from "next/server";
import { memoryQualityLoop } from "@/lib/memory-quality-loop";

export async function GET() {
  return NextResponse.json(await memoryQualityLoop.getState());
}
