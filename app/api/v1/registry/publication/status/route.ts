import { NextResponse } from "next/server";
import { registryPublicationPipeline } from "@/lib/registry-publication";

export async function GET() {
  return NextResponse.json(await registryPublicationPipeline.getState());
}
