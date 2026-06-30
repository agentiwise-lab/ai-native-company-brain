import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createMeetingCrmComposioIngestion,
  meetingCrmComposioIngestion,
  type MeetingCrmComposioClient,
  type MeetingCrmSyncInput
} from "@/lib/meeting-crm-composio-ingestion";

const syncSchema = z.object({
  principalId: z.string(),
  mode: z.enum(["backfill", "incremental"]),
  connectedAccount: z.object({
    id: z.string(),
    status: z.enum(["pending", "active", "revoked", "errored"]),
    principalId: z.string()
  }),
  selectedSources: z.array(z.unknown()),
  allowedScopes: z.array(z.string()).optional(),
  cursor: z.string().optional(),
  mockPages: z.object({
    meetings: z.array(z.unknown()).optional(),
    salesforce: z.array(z.unknown()).optional(),
    hubspot: z.array(z.unknown()).optional()
  }).optional()
});

function mockClient(pages: NonNullable<z.infer<typeof syncSchema>["mockPages"]>): MeetingCrmComposioClient {
  const calls = { meetings: 0, salesforce: 0, hubspot: 0 };
  return {
    async fetchMeetings() {
      const page = pages.meetings?.[Math.min(calls.meetings++, (pages.meetings?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    },
    async fetchSalesforce() {
      const page = pages.salesforce?.[Math.min(calls.salesforce++, (pages.salesforce?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    },
    async fetchHubSpot() {
      const page = pages.hubspot?.[Math.min(calls.hubspot++, (pages.hubspot?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    }
  };
}

export async function POST(request: Request) {
  const body = syncSchema.parse(await request.json());
  const service = body.mockPages
    ? createMeetingCrmComposioIngestion({ meetingCrmClient: mockClient(body.mockPages) })
    : meetingCrmComposioIngestion;
  return NextResponse.json(
    await service.syncMeetingCrm({
      principalId: body.principalId,
      mode: body.mode,
      connectedAccount: body.connectedAccount,
      selectedSources: body.selectedSources as MeetingCrmSyncInput["selectedSources"],
      allowedScopes: body.allowedScopes,
      cursor: body.cursor
    })
  );
}
