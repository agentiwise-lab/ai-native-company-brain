import { NextResponse } from "next/server";
import { z } from "zod";
import { createToolInvocationGateway } from "@/lib/tool-invocation-gateway";

const invokeSchema = z.object({
  principal: z.unknown(),
  tool: z.unknown(),
  controlState: z.unknown().optional(),
  connectedAccountId: z.string(),
  sessionPurpose: z.enum(["interactive-agent", "connector-worker", "cron-job"]),
  packageVersion: z.string(),
  args: z.record(z.unknown()).default({}),
  budgetUsd: z.number().default(1),
  requiresApproval: z.boolean().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Tool invocation failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = invokeSchema.parse(await request.json());
    const gateway = createToolInvocationGateway(
      body.controlState
        ? {
            controlPlane: {
              getState: async () => body.controlState as never
            }
          }
        : {}
    );
    return NextResponse.json(
      await gateway.invoke({
        principal: body.principal as never,
        tool: body.tool as never,
        connectedAccountId: body.connectedAccountId,
        sessionPurpose: body.sessionPurpose,
        packageVersion: body.packageVersion,
        args: body.args,
        budgetUsd: body.budgetUsd,
        requiresApproval: body.requiresApproval
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
