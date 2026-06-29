import type { Changeset, CronRun, KnowledgeAtom, QualityScore, RegistryItem } from "./types";

export function scoreAtom(atom: KnowledgeAtom): number {
  const statusBonus = atom.status === "approved" ? 10 : atom.status === "candidate" ? -8 : -14;
  const sourceBonus = Math.min(atom.sourceIds.length * 5, 15);
  const score = atom.confidence * 40 + atom.freshness * 35 + sourceBonus + statusBonus;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreRegistryItem(item: RegistryItem, changesets: Changeset[]): number {
  const status = {
    draft: 35,
    review: 62,
    approved: 78,
    published: 90,
    deprecated: 45,
    blocked: 20
  }[item.status];
  const dependencyPenalty = item.dependencies.length === 0 && item.kind !== "tool" ? 8 : 0;
  const openBlockedPenalty = changesets.some(
    (changeset) => changeset.targetId === item.id && changeset.status === "blocked"
  )
    ? 20
    : 0;
  return Math.max(0, status - dependencyPenalty - openBlockedPenalty);
}

export function scoreCronRuns(runs: CronRun[]) {
  if (runs.length === 0) {
    return 0;
  }

  const succeeded = runs.filter((run) => run.status === "succeeded").length;
  const needsApproval = runs.filter((run) => run.status === "needs-approval").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  return Math.max(0, Math.round((succeeded / runs.length) * 100 - needsApproval * 8 - failed * 20));
}

export function summarizeQuality(scores: QualityScore[]) {
  const average =
    scores.length === 0 ? 0 : Math.round(scores.reduce((total, score) => total + score.score, 0) / scores.length);
  const riskCount = scores.filter((score) => score.score < 75 || score.conflictRisk > 30).length;

  return {
    average,
    riskCount,
    highest: [...scores].sort((a, b) => b.score - a.score)[0],
    lowest: [...scores].sort((a, b) => a.score - b.score)[0]
  };
}
