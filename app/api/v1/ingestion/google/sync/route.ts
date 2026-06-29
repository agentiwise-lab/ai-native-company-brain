import { NextResponse } from "next/server";
import { z } from "zod";
import { googleComposioIngestion } from "@/lib/google-composio-ingestion";

const roleSchema = z.enum(["admin", "reviewer", "operator", "employee", "agent"]);

const googleSyncSchema = z.object({
  principalId: z.string().min(1),
  mode: z.enum(["backfill", "incremental"]),
  connectedAccount: z.object({
    id: z.string().min(1),
    status: z.enum(["pending", "active", "revoked", "errored"]),
    principalId: z.string().min(1)
  }),
  selectedSources: z.array(
    z.object({
      kind: z.enum(["drive", "gmail"]),
      scope: z.string().min(1),
      name: z.string().min(1),
      teams: z.array(z.string()).default([]),
      roles: z.array(roleSchema).default(["admin", "reviewer", "operator", "agent"]),
      sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
      folderIds: z.array(z.string()).optional(),
      labelIds: z.array(z.string()).optional()
    })
  ).min(1),
  allowedScopes: z.array(z.string()).optional(),
  cursor: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Google ingestion failed" }, { status: 400 });
}

export async function GET() {
  const state = await googleComposioIngestion.syncState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  try {
    const body = googleSyncSchema.parse(await request.json());
    return NextResponse.json(await googleComposioIngestion.syncGoogle(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
