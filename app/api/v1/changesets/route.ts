import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { registryKinds, type RegistryKind } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetTypeParam = url.searchParams.get("targetType");
  const targetType =
    targetTypeParam === "atom" || registryKinds.includes(targetTypeParam as RegistryKind)
      ? (targetTypeParam as "atom" | RegistryKind)
      : undefined;

  return NextResponse.json(await repository.listChangesets(targetType));
}
