import { NextResponse } from "next/server";
import { z } from "zod";
import { durableScheduler } from "@/lib/durable-scheduler";

const jobSchema = z.object({
  id: z.string(),
  tenantId: z.string().default("tenant_demo"),
  name: z.string(),
  schedule: z.string(),
  timezone: z.string().default("UTC"),
  ownerId: z.string(),
  tier: z.enum(["individual", "team", "department", "company-main", "exec-protected", "regulated"]),
  prompt: z.string(),
  allowedTools: z.array(z.string()).default([]),
  dataScopes: z.array(z.string()).default([]),
  budgetUsd: z.number().default(1),
  retryPolicy: z.enum(["none", "linear", "exponential"]).default("exponential"),
  maxRuntimeSeconds: z.number().default(300),
  approvalGates: z.array(z.string()).default([]),
  nextRunAt: z.string(),
  enabled: z.boolean().default(true),
  agentRunner: z.enum(["codex", "claude-code", "opencode", "generic-mcp"]).optional(),
  maxAttempts: z.number().optional()
});

export async function GET() {
  return NextResponse.json(await durableScheduler.listJobs());
}

export async function POST(request: Request) {
  const body = jobSchema.parse(await request.json());
  return NextResponse.json(await durableScheduler.upsertJob(body), { status: 201 });
}
