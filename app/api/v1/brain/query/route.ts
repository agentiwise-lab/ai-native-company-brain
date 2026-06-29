import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { brainTiers } from "@/lib/types";

const bodySchema = z.object({
  query: z.string().default(""),
  principalId: z.string().optional(),
  tier: z.enum(brainTiers).optional()
});

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json().catch(() => ({})));
  return NextResponse.json(repository.queryBrain(body.query, body.principalId, body.tier));
}
