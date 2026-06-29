import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { registryKinds, type RegistryKind } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const kindParam = url.searchParams.get("kind");
  const kind = registryKinds.includes(kindParam as RegistryKind) ? (kindParam as RegistryKind) : undefined;
  const principalId = url.searchParams.get("principalId") ?? undefined;
  return NextResponse.json(await repository.searchRegistry(query, kind, principalId));
}
