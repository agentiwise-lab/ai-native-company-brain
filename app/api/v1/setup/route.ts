import { NextResponse } from "next/server";
import { bootstrapTenant, getSetupState, type BootstrapTenantInput } from "@/lib/setup";

export async function GET() {
  return NextResponse.json(getSetupState());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BootstrapTenantInput>;
    const state = bootstrapTenant({
      tenantName: body.tenantName ?? "",
      adminName: body.adminName ?? "",
      adminEmail: body.adminEmail ?? "",
      encryptionKey: body.encryptionKey ?? "",
      composioProjectId: body.composioProjectId ?? "",
      composioApiKeyConfigured: Boolean(body.composioApiKeyConfigured)
    });

    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup failed.";
    return NextResponse.json(
      {
        error: message
      },
      {
        status: /already bootstrapped/i.test(message) ? 409 : 400
      }
    );
  }
}

