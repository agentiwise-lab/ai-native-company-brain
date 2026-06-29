import { NextResponse } from "next/server";
import { memoryConflictWorkflow } from "@/lib/memory-conflicts";
import { memoryQualityLoop } from "@/lib/memory-quality-loop";
import { repository } from "@/lib/repository";

function usageFromEvents(atomId: string, events: Awaited<ReturnType<typeof repository.dashboard>>["events"]) {
  const retrievals = events.filter((event) => {
    const citations = event.metadata.citations;
    return Array.isArray(citations) && citations.includes(atomId);
  }).length;
  return {
    retrievals,
    successfulAnswers: retrievals
  };
}

export async function POST() {
  const [snapshot, conflicts] = await Promise.all([repository.dashboard(), memoryConflictWorkflow.getState()]);
  const conflictCounts = Object.fromEntries(
    snapshot.atoms.map((atom) => [
      atom.id,
      conflicts.conflicts.filter((conflict) => conflict.candidateAtomId === atom.id || conflict.existingAtomId === atom.id).length
    ])
  );
  const sourceHealth = Object.fromEntries(
    snapshot.atoms.map((atom) => [atom.id, atom.sourceIds.length > 0 ? Math.round(atom.freshness * 100) : 35])
  );
  const usage = Object.fromEntries(snapshot.atoms.map((atom) => [atom.id, usageFromEvents(atom.id, snapshot.events)]));

  return NextResponse.json(
    await memoryQualityLoop.run({
      atoms: snapshot.atoms,
      sourceHealth,
      usage,
      corrections: {},
      conflicts: conflictCounts
    }),
    { status: 201 }
  );
}
