import { NextResponse } from "next/server";
import { z } from "zod";
import { durableScheduler } from "@/lib/durable-scheduler";

const leaseSchema = z.object({
  workerId: z.string(),
  limit: z.number().optional(),
  leaseMs: z.number().optional(),
  now: z.string().optional()
});

export async function POST(request: Request) {
  const body = leaseSchema.parse(await request.json());
  return NextResponse.json(await durableScheduler.leaseDueJobs(body));
}
