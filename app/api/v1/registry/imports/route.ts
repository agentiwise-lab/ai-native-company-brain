import { NextResponse } from "next/server";
import { registryImportService } from "@/lib/registry-import";

export async function GET() {
  return NextResponse.json(await registryImportService.getState());
}
