import { NextResponse } from "next/server";
import { z } from "zod";
import { createCronOutputDelivery, cronOutputDelivery } from "@/lib/cron-output-delivery";
import { principals } from "@/lib/seed";

const destinationSchema = z.object({
  id: z.string(),
  type: z.enum(["slack", "email", "webhook", "dashboard"]),
  uri: z.string(),
  toolId: z.string().optional(),
  connectedAccountId: z.string().optional(),
  requiresApproval: z.boolean().optional(),
  quietWindowMinutes: z.number().optional()
});

const deliverSchema = z.object({
  principal: z.unknown().optional(),
  principalId: z.string().optional(),
  cronJobId: z.string(),
  runId: z.string(),
  output: z.string(),
  allowedTools: z.array(z.string()).default([]),
  budgetUsd: z.number().default(1),
  destinations: z.array(destinationSchema),
  dedupeKey: z.string().optional(),
  sensitive: z.boolean().optional(),
  registryItems: z.array(z.unknown()).optional()
});

function resolvePrincipal(principal: unknown, principalId?: string) {
  if (principal && typeof principal === "object") {
    return principal as never;
  }
  return principals.find((candidate) => candidate.id === principalId) ?? principals[0];
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Cron output delivery failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = deliverSchema.parse(await request.json());
    const service = body.registryItems ? createCronOutputDelivery({ registryItems: body.registryItems }) : cronOutputDelivery;
    return NextResponse.json(
      await service.deliver({
        principal: resolvePrincipal(body.principal, body.principalId),
        cronJobId: body.cronJobId,
        runId: body.runId,
        output: body.output,
        allowedTools: body.allowedTools,
        budgetUsd: body.budgetUsd,
        destinations: body.destinations,
        dedupeKey: body.dedupeKey,
        sensitive: body.sensitive
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
