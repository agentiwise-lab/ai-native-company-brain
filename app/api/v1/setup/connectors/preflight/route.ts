import { NextResponse } from "next/server";
import { getSetupState } from "@/lib/setup";

export async function GET() {
  const state = getSetupState();
  return NextResponse.json({
    onboardingStatus: state.onboarding?.status ?? "not-started",
    connectorPreflights: state.connectorPreflights,
    setupTasks: state.setupTasks.filter((task) => task.id === "connector-preflight")
  });
}
