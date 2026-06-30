import { NextResponse } from "next/server";
import { identityOrgSync } from "@/lib/identity-org-sync";

export async function GET() {
  return NextResponse.json(await identityOrgSync.getState());
}
