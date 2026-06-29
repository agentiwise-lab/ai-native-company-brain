import { NextResponse } from "next/server";
import { z } from "zod";
import { workComposioIngestion } from "@/lib/work-composio-ingestion";

const roleSchema = z.enum(["admin", "reviewer", "operator", "employee", "agent"]);

const workSyncSchema = z.object({
  principalId: z.string().min(1),
  mode: z.enum(["backfill", "incremental"]),
  connectedAccount: z.object({
    id: z.string().min(1),
    status: z.enum(["pending", "active", "revoked", "errored"]),
    principalId: z.string().min(1)
  }),
  selectedSources: z.array(
    z.object({
      kind: z.enum(["github", "linear"]),
      scope: z.string().min(1),
      name: z.string().min(1),
      teams: z.array(z.string()).default([]),
      roles: z.array(roleSchema).default(["admin", "reviewer", "operator", "agent"]),
      sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal")
    })
  ).min(1),
  allowedScopes: z.array(z.string()).optional(),
  cursor: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Work ingestion failed" }, { status: 400 });
}

export async function GET() {
  const state = await workComposioIngestion.syncState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  try {
    const body = workSyncSchema.parse(await request.json());
    return NextResponse.json(await workComposioIngestion.syncWork(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
