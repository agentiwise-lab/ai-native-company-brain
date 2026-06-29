import { NextResponse } from "next/server";
import { cronOutputDelivery } from "@/lib/cron-output-delivery";

export async function GET() {
  return NextResponse.json(await cronOutputDelivery.getState());
}
