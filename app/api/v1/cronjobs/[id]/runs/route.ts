import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json(await repository.listCronRuns(id));
}
