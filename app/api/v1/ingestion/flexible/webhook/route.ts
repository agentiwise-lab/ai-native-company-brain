import { NextResponse } from "next/server";
import { z } from "zod";
import { flexibleComposioIngestion } from "@/lib/flexible-composio-ingestion";

const roleSchema = z.enum(["admin", "reviewer", "operator", "employee", "agent"]);

const webhookSchema = z.object({
  secret: z.string().min(1),
  signature: z.string().min(1),
  payload: z.object({
    sourceId: z.string().min(1),
    sourceType: z.enum(["slack", "email", "docs", "meeting", "ticket", "crm", "code", "agent-transcript"]),
    title: z.string().min(1),
    provenanceUrl: z.string().url(),
    principalId: z.string().min(1),
    content: z.string().min(1),
    raw: z.record(z.unknown()),
    acl: z.object({
      teams: z.array(z.string()),
      roles: z.array(roleSchema),
      sensitivity: z.enum(["public", "internal", "confidential", "restricted"])
    })
  })
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook ingestion failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = webhookSchema.parse(await request.json());
    return NextResponse.json(await flexibleComposioIngestion.ingestWebhook(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
