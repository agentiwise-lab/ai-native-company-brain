import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { artifactProcessingPipeline, type ArtifactChunk, type ArtifactProcessingState } from "./artifact-processing";
import type { NormalizedComposioArtifact } from "./composio-ingestion";
import { repository as defaultRepository } from "./repository";
import type { BrainRepository, CommitBrainInput } from "./repository-contract";
import type { BrainTier, Changeset, KnowledgeAtom, ReviewCheck } from "./types";

export type SourceEvidence = {
  artifactId: string;
  chunkId: string;
  offsetStart: number;
  offsetEnd: number;
  provenanceUrl: string;
  excerpt: string;
  checksum: string;
};

export type CandidateExtractionRecord = {
  id: string;
  runId: string;
  artifactId: string;
  chunkId: string;
  atom: KnowledgeAtom;
  changeset: Changeset;
  sourceEvidence: SourceEvidence;
  targetTier: BrainTier;
  ownerId: string;
  reviewers: string[];
  createdAt: string;
};

export type CandidateExtractionRun = {
  id: string;
  status: "completed" | "failed";
  artifactIds: string[];
  candidateCount: number;
  skippedChunkCount: number;
  failureReason?: string;
  updatedAt: string;
};

export type CandidateExtractionState = {
  runs: CandidateExtractionRun[];
  candidates: CandidateExtractionRecord[];
};

export type CandidateExtractionStore = {
  read(): Promise<CandidateExtractionState | null>;
  write(state: CandidateExtractionState): Promise<void>;
};

export type OwnerRule = {
  id: string;
  match: RegExp;
  ownerId: string;
  reviewers: string[];
  tier?: BrainTier;
};

type CandidateExtractionOptions = {
  artifactProcessing?: { getState(): Promise<ArtifactProcessingState> };
  repository?: Pick<BrainRepository, "commitBrain">;
  store?: CandidateExtractionStore;
  now?: () => string;
  ownerRules?: OwnerRule[];
  fallbackOwnerId?: string;
  fallbackReviewers?: string[];
};

export type CandidateExtractionInput = {
  artifactIds?: string[];
  artifacts?: NormalizedComposioArtifact[];
  principalId?: string;
};

type ProposedCandidate = {
  atomType: KnowledgeAtom["atomType"];
  title: string;
  body: string;
  summary: string;
  confidence: number;
  targetTier: BrainTier;
  ownerId: string;
  reviewers: string[];
  tags: string[];
  sourceEvidence: SourceEvidence;
  checks: ReviewCheck[];
  changesetStatus: Changeset["status"];
};

function defaultStatePath() {
  return process.env.CANDIDATE_EXTRACTION_STATE_PATH ?? join(process.cwd(), "data", "candidate-extraction-state.json");
}

function createFileStore(path = defaultStatePath()): CandidateExtractionStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as CandidateExtractionState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): CandidateExtractionState {
  return {
    runs: [],
    candidates: []
  };
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function words(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function clip(text: string, maxLength: number) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function stripTypePrefix(text: string) {
  return text.replace(/^(decision|procedure|policy|lesson learned|lesson|fact|claim)\s*:\s*/i, "");
}

function firstSentence(text: string) {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/^(.+?[.!?])(\s|$)/);
  return stripTypePrefix(match?.[1] ?? normalized);
}

function atomTypeFor(text: string): KnowledgeAtom["atomType"] | null {
  if (/\b(policy|must|required|regulated|retention|compliance|security|approval gate)\b/i.test(text)) {
    return "policy";
  }
  if (/\b(procedure|process|workflow|runbook|steps?|when .+ check|how to)\b/i.test(text)) {
    return "procedure";
  }
  if (/\b(decision|decided|approved|chosen|go with|will use|ship)\b/i.test(text)) {
    return "decision";
  }
  if (/\b(lesson learned|lesson|postmortem|root cause|caused|avoid|worked|failed)\b/i.test(text)) {
    return "lesson";
  }
  if (/\b(uses|is|are|owns|supports|depends on|source evidence|dashboard)\b/i.test(text)) {
    return "claim";
  }
  return null;
}

function confidenceFor(text: string, atomType: KnowledgeAtom["atomType"], hasArtifact: boolean, promptRisk: ArtifactChunk["promptInjectionRisk"]) {
  let score = 0.56;
  if (/^(decision|procedure|policy|lesson learned|lesson)\s*:/i.test(text)) {
    score += 0.14;
  }
  if (atomType !== "claim") {
    score += 0.08;
  }
  if (hasArtifact) {
    score += 0.08;
  }
  if (/\b(maybe|i think|probably|someone agrees|unclear|not sure)\b/i.test(text)) {
    score -= 0.28;
  }
  if (promptRisk === "medium") {
    score -= 0.08;
  }
  if (promptRisk === "high") {
    score -= 0.22;
  }
  return Math.max(0.1, Math.min(0.95, Number(score.toFixed(2))));
}

function suggestedTier(chunk: ArtifactChunk, atomType: KnowledgeAtom["atomType"]): BrainTier {
  if (chunk.classifiedSensitivity === "restricted") {
    return "regulated";
  }
  if (chunk.classifiedSensitivity === "confidential") {
    return atomType === "policy" ? "department" : "team";
  }
  if (atomType === "policy") {
    return "company-main";
  }
  return "team";
}

function ownerFor({
  chunk,
  artifact,
  ownerRules,
  fallbackOwnerId,
  fallbackReviewers
}: {
  chunk: ArtifactChunk;
  artifact?: NormalizedComposioArtifact;
  ownerRules: OwnerRule[];
  fallbackOwnerId: string;
  fallbackReviewers: string[];
}) {
  if (artifact?.source.ownerId) {
    return {
      ownerId: artifact.source.ownerId,
      reviewers: fallbackReviewers,
      tier: artifact.source.tier
    };
  }

  const rule = ownerRules.find((candidate) => candidate.match.test(chunk.text));
  if (rule) {
    return {
      ownerId: rule.ownerId,
      reviewers: rule.reviewers,
      tier: rule.tier
    };
  }

  return {
    ownerId: fallbackOwnerId,
    reviewers: fallbackReviewers,
    tier: undefined
  };
}

function checksFor(confidence: number, evidence: SourceEvidence): ReviewCheck[] {
  return [
    {
      id: "check_source_snippet",
      label: "Source snippet attached",
      status: evidence.excerpt ? "passed" : "failed",
      detail: evidence.excerpt ? `Offsets ${evidence.offsetStart}-${evidence.offsetEnd} are attached.` : "Missing source excerpt."
    },
    {
      id: "check_confidence",
      label: "Extraction confidence",
      status: confidence >= 0.55 ? "passed" : "failed",
      detail: confidence >= 0.55 ? `${Math.round(confidence * 100)}% confidence.` : "Low confidence candidate needs reviewer rewrite."
    }
  ];
}

function proposeCandidate(
  chunk: ArtifactChunk,
  artifact: NormalizedComposioArtifact | undefined,
  ownerRules: OwnerRule[],
  fallbackOwnerId: string,
  fallbackReviewers: string[]
): ProposedCandidate | null {
  const text = normalizeWhitespace(chunk.text);
  if (words(text).length < 6) {
    return null;
  }

  const atomType = atomTypeFor(text);
  if (!atomType) {
    return null;
  }

  const owner = ownerFor({ chunk, artifact, ownerRules, fallbackOwnerId, fallbackReviewers });
  const targetTier = owner.tier ?? suggestedTier(chunk, atomType);
  const confidence = confidenceFor(text, atomType, Boolean(artifact), chunk.promptInjectionRisk);
  const evidence: SourceEvidence = {
    artifactId: chunk.artifactId,
    chunkId: chunk.id,
    offsetStart: chunk.offsetStart,
    offsetEnd: chunk.offsetEnd,
    provenanceUrl: chunk.provenanceUrl,
    excerpt: clip(text, 360),
    checksum: chunk.lineageChecksum
  };
  const summary = clip(firstSentence(text), 180);
  const typeLabel = atomType[0].toUpperCase() + atomType.slice(1);
  const title = clip(`${typeLabel}: ${summary}`, 92);
  const checks = checksFor(confidence, evidence);

  return {
    atomType,
    title,
    body: [
      summary,
      "",
      "Source evidence:",
      `- Artifact: ${chunk.artifactId}`,
      `- Chunk: ${chunk.id}`,
      `- Offsets: ${chunk.offsetStart}-${chunk.offsetEnd}`,
      `- Provenance: ${chunk.provenanceUrl}`,
      "",
      "Excerpt:",
      evidence.excerpt
    ].join("\n"),
    summary,
    confidence,
    targetTier,
    ownerId: owner.ownerId,
    reviewers: owner.reviewers,
    tags: [
      "candidate",
      "extracted",
      "source-linked",
      `connector:${chunk.connector}`,
      `chunk:${chunk.id}`,
      `type:${atomType}`
    ],
    sourceEvidence: evidence,
    checks,
    changesetStatus: confidence >= 0.55 ? "review" : "blocked"
  };
}

function safeFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : "Candidate extraction failed.";
  return message.split(":")[0].trim();
}

export function createCandidateExtractionWorker(options: CandidateExtractionOptions = {}) {
  const store = options.store ?? createFileStore();
  const artifactProcessing = options.artifactProcessing;
  const repository = options.repository;
  const now = options.now ?? (() => new Date().toISOString());
  const ownerRules = options.ownerRules ?? [
    {
      id: "security",
      match: /security|compliance|regulated|restricted|retention/i,
      ownerId: "usr_reviewer",
      reviewers: ["usr_reviewer"],
      tier: "department"
    }
  ];
  const fallbackOwnerId = options.fallbackOwnerId ?? "usr_admin";
  const fallbackReviewers = options.fallbackReviewers ?? ["usr_reviewer"];

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: CandidateExtractionState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async run(input: CandidateExtractionInput = {}) {
      if (!artifactProcessing) {
        throw new Error("Candidate extraction requires an artifact processing pipeline.");
      }
      if (!repository) {
        throw new Error("Candidate extraction requires a brain repository.");
      }

      const state = await load();
      const startedAt = now();
      const processingState = await artifactProcessing.getState();
      const artifactsById = new Map((input.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
      const indexedArtifactIds = new Set(
        processingState.records
          .filter((record) => record.status === "indexed")
          .map((record) => record.artifactId)
      );
      const requestedArtifactIds = input.artifactIds?.length ? new Set(input.artifactIds) : undefined;
      const chunks = processingState.chunks.filter((chunk) => {
        if (!indexedArtifactIds.has(chunk.artifactId)) {
          return false;
        }
        return requestedArtifactIds ? requestedArtifactIds.has(chunk.artifactId) : true;
      });
      const run: CandidateExtractionRun = {
        id: `extract_${Date.parse(startedAt)}_${Math.random().toString(36).slice(2, 8)}`,
        status: "completed",
        artifactIds: [...new Set(chunks.map((chunk) => chunk.artifactId))],
        candidateCount: 0,
        skippedChunkCount: 0,
        updatedAt: startedAt
      };

      try {
        const records: CandidateExtractionRecord[] = [];
        for (const chunk of chunks) {
          const artifact = artifactsById.get(chunk.artifactId);
          const proposal = proposeCandidate(chunk, artifact, ownerRules, fallbackOwnerId, fallbackReviewers);
          if (!proposal) {
            run.skippedChunkCount += 1;
            continue;
          }

          const commitInput: CommitBrainInput = {
            title: proposal.title,
            body: proposal.body,
            tier: proposal.targetTier,
            principalId: input.principalId ?? "usr_admin",
            sourceIds: [chunk.artifactId],
            sourceUri: chunk.provenanceUrl,
            sourceTitle: artifact?.source.title ?? chunk.artifactId,
            atomType: proposal.atomType,
            ownerId: proposal.ownerId,
            reviewers: proposal.reviewers,
            acl: {
              teams: chunk.acl.teams,
              roles: chunk.acl.roles,
              sensitivity: chunk.classifiedSensitivity
            },
            confidence: proposal.confidence,
            freshness: 1,
            tags: proposal.tags,
            changesetSummary: `Extracted ${proposal.atomType} candidate from ${chunk.connector} source evidence for reviewer curation.`,
            changesetStatus: proposal.changesetStatus,
            reviewChecks: proposal.checks
          };
          const committed = await repository.commitBrain(commitInput);
          records.push({
            id: `candidate_${committed.atom.id}`,
            runId: run.id,
            artifactId: chunk.artifactId,
            chunkId: chunk.id,
            atom: committed.atom,
            changeset: committed.changeset,
            sourceEvidence: proposal.sourceEvidence,
            targetTier: proposal.targetTier,
            ownerId: proposal.ownerId,
            reviewers: proposal.reviewers,
            createdAt: now()
          });
        }

        run.candidateCount = records.length;
        run.updatedAt = now();
        state.runs = [run, ...state.runs];
        state.candidates = [...records, ...state.candidates];
        await save(state);
        return { run, candidates: records };
      } catch (error) {
        run.status = "failed";
        run.failureReason = safeFailureReason(error);
        run.updatedAt = now();
        state.runs = [run, ...state.runs];
        await save(state);
        throw error;
      }
    }
  };
}

export const candidateExtractionWorker = createCandidateExtractionWorker({
  artifactProcessing: artifactProcessingPipeline,
  repository: defaultRepository
});
