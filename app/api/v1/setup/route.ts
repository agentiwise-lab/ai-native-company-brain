import { NextResponse } from "next/server";
import { bootstrapTenant, getSetupState, type BootstrapTenantInput } from "@/lib/setup";
import { brainTiers } from "@/lib/types";

export async function GET() {
  return NextResponse.json(getSetupState());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BootstrapTenantInput>;
    const selectedBrainTiers = Array.isArray(body.selectedBrainTiers)
      ? body.selectedBrainTiers.filter((tier) => brainTiers.includes(tier))
      : body.selectedBrainTiers;
    const state = bootstrapTenant({
      tenantName: body.tenantName ?? "",
      adminName: body.adminName ?? "",
      adminEmail: body.adminEmail ?? "",
      encryptionKey: body.encryptionKey ?? "",
      composioProjectId: body.composioProjectId ?? "",
      composioApiKeyConfigured: Boolean(body.composioApiKeyConfigured),
      mode: body.mode,
      companyDescription: body.companyDescription,
      departments: body.departments,
      teams: body.teams,
      people: body.people,
      goals: body.goals,
      challenges: body.challenges,
      sensitiveAreas: body.sensitiveAreas,
      selectedConnectors: body.selectedConnectors,
      selectedBrainTiers,
      supabaseProjectRef: body.supabaseProjectRef,
      supabaseProjectUrl: body.supabaseProjectUrl,
      approveSetupPlan: body.approveSetupPlan
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
