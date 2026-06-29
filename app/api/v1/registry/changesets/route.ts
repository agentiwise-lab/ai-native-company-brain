import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";

const bodySchema = z.object({
  title: z.string().min(1),
  targetId: z.string().min(1),
  principalId: z.string().optional()
});

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json());
  const changeset = await repository.createRegistryChangeset(body);

  if (!changeset) {
    return NextResponse.json({ error: "Target registry item not found" }, { status: 404 });
  }

  return NextResponse.json(changeset, { status: 201 });
}
