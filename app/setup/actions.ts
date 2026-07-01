"use server";

import { redirect } from "next/navigation";
import { bootstrapTenant, type OnboardingMode } from "@/lib/setup";
import { brainTiers, type BrainTier } from "@/lib/types";

function selectedBrainTiers(formData: FormData): BrainTier[] {
  return formData
    .getAll("selectedBrainTiers")
    .map((tier) => String(tier))
    .filter((tier): tier is BrainTier => brainTiers.includes(tier as BrainTier));
}

export async function bootstrapTenantFromForm(formData: FormData) {
  bootstrapTenant({
    tenantName: String(formData.get("tenantName") ?? ""),
    adminName: String(formData.get("adminName") ?? ""),
    adminEmail: String(formData.get("adminEmail") ?? ""),
    encryptionKey: String(formData.get("encryptionKey") ?? ""),
    composioProjectId: String(formData.get("composioProjectId") ?? ""),
    composioApiKeyConfigured: formData.get("composioApiKeyConfigured") === "on",
    mode: String(formData.get("mode") ?? "supabase-local") as OnboardingMode,
    companyDescription: String(formData.get("companyDescription") ?? ""),
    departments: String(formData.get("departments") ?? ""),
    teams: String(formData.get("teams") ?? ""),
    people: String(formData.get("people") ?? ""),
    goals: String(formData.get("goals") ?? ""),
    challenges: String(formData.get("challenges") ?? ""),
    sensitiveAreas: String(formData.get("sensitiveAreas") ?? ""),
    selectedConnectors: formData.getAll("selectedConnectors").map((connector) => String(connector)),
    selectedBrainTiers: selectedBrainTiers(formData),
    supabaseProjectRef: String(formData.get("supabaseProjectRef") ?? ""),
    supabaseProjectUrl: String(formData.get("supabaseProjectUrl") ?? ""),
    approveSetupPlan: formData.get("approveSetupPlan") === "on"
  });

  redirect("/");
}
