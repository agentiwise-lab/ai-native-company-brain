import { NextResponse } from "next/server";
import { cloudControlPlane } from "@/lib/cloud-control-plane";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await cloudControlPlane.getState();
  const tenant = state.tenants.find((candidate) => candidate.id === id);
  if (!tenant) {
    return NextResponse.json({ error: `Tenant ${id} was not found.` }, { status: 404 });
  }
  return NextResponse.json({ tenantId: tenant.id, diagnostics: tenant.diagnostics, composioHandoff: tenant.composioHandoff });
}
