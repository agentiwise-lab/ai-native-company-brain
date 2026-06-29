import { NextResponse } from "next/server";
import { z } from "zod";
import { registryImportService } from "@/lib/registry-import";

const importSchema = z.object({
  package: z.unknown(),
  principalId: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Registry import failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await request.json());
    return NextResponse.json(await registryImportService.importPackage(body.package, { principalId: body.principalId }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
