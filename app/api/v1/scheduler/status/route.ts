import { NextResponse } from "next/server";
import { durableScheduler } from "@/lib/durable-scheduler";

export async function GET() {
  return NextResponse.json(await durableScheduler.getState());
}
