import { NextResponse } from "next/server";
import { z } from "zod";
import { flexibleComposioIngestion } from "@/lib/flexible-composio-ingestion";

const roleSchema = z.enum(["admin", "reviewer", "operator", "employee", "agent"]);

const notionSyncSchema = z.object({
  principalId: z.string().min(1),
  mode: z.enum(["backfill", "incremental"]),
  connectedAccount: z.object({
    id: z.string().min(1),
    status: z.enum(["pending", "active", "revoked", "errored"]),
    principalId: z.string().min(1)
  }),
  selectedSources: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["page", "database"]),
      name: z.string().min(1),
      teams: z.array(z.string()).default([]),
      roles: z.array(roleSchema).default(["admin", "reviewer", "operator", "agent"]),
      sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal")
    })
  ).min(1),
  allowedSourceIds: z.array(z.string()).optional(),
  cursor: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Notion ingestion failed" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = notionSyncSchema.parse(await request.json());
    return NextResponse.json(await flexibleComposioIngestion.syncNotion(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
