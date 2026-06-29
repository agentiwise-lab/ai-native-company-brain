import { NextResponse } from "next/server";
import { z } from "zod";
import { brainHealthAgent } from "@/lib/brain-health-agent";

const enableSchema = z.object({
  ownerId: z.string(),
  tier: z.enum(["individual", "team", "department", "company-main", "exec-protected", "regulated"]),
  budgetUsd: z.number(),
  outputDestination: z.string(),
  timezone: z.string().optional(),
  approvalGates: z.array(z.string()).optional()
});

export async function POST(request: Request) {
  return NextResponse.json(await brainHealthAgent.enableWeeklyJob(enableSchema.parse(await request.json())));
}
