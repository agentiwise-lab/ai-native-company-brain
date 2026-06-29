import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { brainTiers } from "@/lib/types";

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  tier: z.enum(brainTiers).optional(),
  principalId: z.string().optional()
});

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json());
  return NextResponse.json(await repository.commitBrain(body), { status: 201 });
}
