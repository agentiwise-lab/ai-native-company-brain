import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = repository.rollbackRegistryItem(id);

  if (!result.item) {
    return NextResponse.json({ error: "Registry item not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
