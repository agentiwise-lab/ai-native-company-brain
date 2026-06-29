import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await repository.runCronJob(id);

  if (!result.job || !result.run) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  return NextResponse.json(result.run, { status: result.run.status === "needs-approval" ? 202 : 200 });
}
