import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createEnterpriseComposioIngestion,
  enterpriseComposioIngestion,
  type EnterpriseComposioClient,
  type EnterpriseSyncInput
} from "@/lib/enterprise-composio-ingestion";

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
    microsoft: z.array(z.unknown()).optional(),
    jira: z.array(z.unknown()).optional(),
    confluence: z.array(z.unknown()).optional(),
    gitlab: z.array(z.unknown()).optional()
  }).optional()
});

function mockClient(pages: NonNullable<z.infer<typeof syncSchema>["mockPages"]>): EnterpriseComposioClient {
  const calls = { microsoft: 0, jira: 0, confluence: 0, gitlab: 0 };
  return {
    async fetchMicrosoft() {
      const page = pages.microsoft?.[Math.min(calls.microsoft++, (pages.microsoft?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    },
    async fetchJira() {
      const page = pages.jira?.[Math.min(calls.jira++, (pages.jira?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    },
    async fetchConfluence() {
      const page = pages.confluence?.[Math.min(calls.confluence++, (pages.confluence?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    },
    async fetchGitLab() {
      const page = pages.gitlab?.[Math.min(calls.gitlab++, (pages.gitlab?.length ?? 1) - 1)];
      return (page ?? { items: [], nextCursor: undefined }) as never;
    }
  };
}

export async function POST(request: Request) {
  const body = syncSchema.parse(await request.json());
  const service = body.mockPages
    ? createEnterpriseComposioIngestion({ enterpriseClient: mockClient(body.mockPages) })
    : enterpriseComposioIngestion;
  return NextResponse.json(
    await service.syncEnterprise({
      principalId: body.principalId,
      mode: body.mode,
      connectedAccount: body.connectedAccount,
      selectedSources: body.selectedSources as EnterpriseSyncInput["selectedSources"],
      allowedScopes: body.allowedScopes,
      cursor: body.cursor
    })
  );
}
