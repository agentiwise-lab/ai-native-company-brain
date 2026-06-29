"use server";

import { redirect } from "next/navigation";
import { bootstrapTenant } from "@/lib/setup";

export async function bootstrapTenantFromForm(formData: FormData) {
  bootstrapTenant({
    tenantName: String(formData.get("tenantName") ?? ""),
    adminName: String(formData.get("adminName") ?? ""),
    adminEmail: String(formData.get("adminEmail") ?? ""),
    encryptionKey: String(formData.get("encryptionKey") ?? ""),
    composioProjectId: String(formData.get("composioProjectId") ?? ""),
    composioApiKeyConfigured: formData.get("composioApiKeyConfigured") === "on"
  });

  redirect("/");
}

