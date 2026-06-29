import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await repository.getCronJob(id);

  if (!job) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await repository.getCronJob(id);

  if (!job) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  return NextResponse.json({
    ...job,
    ...body,
    status: "review",
    message: "Cron job update staged as a changeset; published job remains unchanged until review."
  });
}
