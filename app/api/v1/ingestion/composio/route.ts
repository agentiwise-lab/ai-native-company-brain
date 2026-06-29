import { NextResponse } from "next/server";
import { z } from "zod";
import { composioIngestionPipeline } from "@/lib/composio-ingestion";

const roleSchema = z.enum(["admin", "reviewer", "operator", "employee", "agent"]);
const sourceTypeSchema = z.enum(["slack", "email", "docs", "meeting", "ticket", "crm", "code", "agent-transcript"]);

const ingestSchema = z.object({
  connector: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceObjectId: z.string().min(1),
  sourceUpdatedAt: z.string().optional(),
  principalId: z.string().min(1),
  connectedAccount: z.object({
    id: z.string().min(1),
    status: z.enum(["pending", "active", "revoked", "errored"]),
    principalId: z.string().min(1)
  }),
  provenanceUrl: z.string().url(),
  title: z.string().min(1),
  normalizedText: z.string().min(1),
  raw: z.record(z.unknown()),
  acl: z.object({
    teams: z.array(z.string()),
    roles: z.array(roleSchema),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"])
  }),
  checkpoint: z.object({ cursor: z.string().optional() }).optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Composio ingestion failed" }, { status: 400 });
}

export async function GET() {
  const state = await composioIngestionPipeline.getState();
  return NextResponse.json({
    artifacts: state.artifacts.length,
    checkpoints: state.checkpoints.length,
    runs: state.runs.slice(0, 10),
    auditEvents: state.auditEvents.slice(0, 10)
  });
}

export async function POST(request: Request) {
  try {
    const body = ingestSchema.parse(await request.json());
    const result = await composioIngestionPipeline.ingestComposioResult(body);
    return NextResponse.json(result, { status: result.status === "duplicate" ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
