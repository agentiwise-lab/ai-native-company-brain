import { NextResponse } from "next/server";
import { handleMcpRequest } from "@/lib/mcp";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(handleMcpRequest(body));
}

export async function GET() {
  return NextResponse.json({
    name: "company-brain",
    protocolVersion: "2025-06-18",
    endpoint: "/api/mcp",
    methods: ["initialize", "tools/list", "tools/call", "resources/list", "resources/read", "prompts/list"]
  });
}
