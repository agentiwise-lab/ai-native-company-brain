import { NextResponse } from "next/server";
import { agentExportService } from "@/lib/agent-exports";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const bundle = await agentExportService.getBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: `Export bundle ${id} was not found.` }, { status: 404 });
  }

  return NextResponse.json(bundle, {
    headers: {
      "content-disposition": `attachment; filename="${bundle.filename}"`
    }
  });
}
