import { NextResponse } from "next/server";
import { approveSetupPlan } from "@/lib/setup";

export async function POST() {
  try {
    return NextResponse.json(approveSetupPlan());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup approval failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
