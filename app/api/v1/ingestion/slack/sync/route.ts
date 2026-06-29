import { NextResponse } from "next/server";
import { z } from "zod";
import { slackComposioIngestion } from "@/lib/slack-composio-ingestion";

const roleSchema = z.enum(["admin", "reviewer", "operator", "employee", "agent"]);

const slackSyncSchema = z.object({
  principalId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().optional(),
  mode: z.enum(["backfill", "incremental"]),
  connectedAccount: z.object({
    id: z.string().min(1),
    status: z.enum(["pending", "active", "revoked", "errored"]),
    principalId: z.string().min(1)
  }),
  selectedChannels: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      teams: z.array(z.string()).default([]),
      roles: z.array(roleSchema).default(["admin", "reviewer", "operator", "agent"]),
      sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal")
    })
  ).min(1),
  allowedChannelIds: z.array(z.string()).optional(),
  sinceTs: z.string().optional(),
  untilTs: z.string().optional(),
  cursor: z.string().optional()
});

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Slack ingestion failed" }, { status: 400 });
}

export async function GET() {
  const state = await slackComposioIngestion.syncState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  try {
    const body = slackSyncSchema.parse(await request.json());
    return NextResponse.json(await slackComposioIngestion.syncSlack(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
