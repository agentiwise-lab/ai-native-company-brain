import { NextResponse } from "next/server";
import { z } from "zod";
import { createAgentExportService, agentExportService } from "@/lib/agent-exports";

const exportSchema = z.object({
  packageId: z.string(),
  targets: z.array(z.enum(["codex", "claude-code", "opencode", "generic-mcp"])).optional(),
  registryItems: z.array(z.unknown()).optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Agent export failed" }, { status: 400 });
}

export async function GET() {
  return NextResponse.json(await agentExportService.getState());
}

export async function POST(request: Request) {
  try {
    const body = exportSchema.parse(await request.json());
    const service = body.registryItems
      ? createAgentExportService({
          registryItems: body.registryItems as never
        })
      : agentExportService;
    return NextResponse.json(await service.generatePackageExports({ packageId: body.packageId, targets: body.targets }));
  } catch (error) {
    return errorResponse(error);
  }
}
