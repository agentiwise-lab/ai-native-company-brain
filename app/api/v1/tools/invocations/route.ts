import { NextResponse } from "next/server";
import { toolInvocationGateway } from "@/lib/tool-invocation-gateway";

export async function GET() {
  return NextResponse.json(await toolInvocationGateway.getState());
}
