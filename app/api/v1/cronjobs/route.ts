import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";

const bodySchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  timezone: z.string().default("UTC"),
  prompt: z.string().min(1)
});

export async function GET() {
  return NextResponse.json(repository.listCronJobs());
}

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json());
  return NextResponse.json(
    {
      id: `cron_candidate_${Date.now()}`,
      status: "review",
      ...body,
      message: "Cron job proposal created. Shared schedules publish only after owner, policy, budget, and reviewer checks pass."
    },
    { status: 201 }
  );
}
