import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const lineage = repository.lineage(id);

  if (!lineage.atom) {
    return NextResponse.json({ error: "Atom not found" }, { status: 404 });
  }

  return NextResponse.json(lineage);
}
