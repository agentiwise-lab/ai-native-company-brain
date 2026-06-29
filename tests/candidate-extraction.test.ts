import { describe, expect, it } from "vitest";
import type { ArtifactProcessingState, ArtifactProcessingStore, ArtifactChunk } from "../lib/artifact-processing";
import { createCandidateExtractionWorker, type CandidateExtractionState, type CandidateExtractionStore } from "../lib/candidate-extraction";
import type { CommitBrainInput } from "../lib/repository-contract";
import { createSeedRepository } from "../lib/seed-repository";
import type { Changeset, KnowledgeAtom } from "../lib/types";
import type { NormalizedComposioArtifact } from "../lib/composio-ingestion";

function createExtractionStore(initial?: Partial<CandidateExtractionState>) {
  let state: CandidateExtractionState | null = initial
    ? {
        runs: [],
        candidates: [],
        ...initial
      }
    : null;

  const store: CandidateExtractionStore & { snapshot: () => CandidateExtractionState | null } = {
    async read() {
      return state;
    },
    async write(next) {
      state = next;
    },
    snapshot() {
      return state;
    }
  };

  return store;
}

function createProcessingStore(chunks: ArtifactChunk[]) {
  const artifactIds = [...new Set(chunks.map((candidate) => candidate.artifactId))];
  const state: ArtifactProcessingState = {
    records: artifactIds.map((artifactId) => ({
      artifactId,
      connector: "slack",
      status: "indexed",
      stage: "index",
      version: 1,
      retryable: false,
      chunkCount: chunks.filter((candidate) => candidate.artifactId === artifactId).length,
      updatedAt: "2026-06-29T10:00:00.000Z"
    })),
    chunks,
    fullTextIndex: [],
    vectorIndex: []
  };

  const store: ArtifactProcessingStore & { snapshot: () => ArtifactProcessingState } = {
    async read() {
      return state;
    },
    async write() {
      throw new Error("Processing state is read-only in candidate extraction tests.");
    },
    snapshot() {
      return state;
    }
  };

  return store;
}

function chunk(overrides: Partial<ArtifactChunk> = {}): ArtifactChunk {
  return {
    id: "src_artifact_1:chunk:0",
    artifactId: "src_artifact_1",
    connector: "slack",
    chunkIndex: 0,
    text: "Decision: the platform team approved Composio for connector execution.",
    offsetStart: 0,
    offsetEnd: 70,
    provenanceUrl: "https://slack.example.com/archives/C123/p1",
    acl: {
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    classifiedSensitivity: "internal",
    promptInjectionRisk: "low",
    lineageChecksum: "sha256:chunk",
    ...overrides
  };
}

function artifact(overrides: Partial<NormalizedComposioArtifact> = {}): NormalizedComposioArtifact {
  return {
    id: "src_artifact_1",
    tenantId: "tenant_demo",
    connector: "slack",
    sourceObjectId: "slack:T123:C123:thread_1",
    connectedAccountId: "acct_slack",
    principalId: "usr_admin",
    provenanceUrl: "https://slack.example.com/archives/C123/p1",
    rawObjectKey: "composio/slack/thread_1/raw.json",
    raw: { mimeType: "text/plain" },
    normalizedText: "Decision: the platform team approved Composio for connector execution.",
    acl: {
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    checksum: "sha256:chunk",
    source: {
      id: "src_artifact_1",
      tenantId: "tenant_demo",
      sourceType: "slack",
      title: "Slack connector decision",
      uri: "https://slack.example.com/archives/C123/p1",
      ownerId: "usr_source_owner",
      tier: "team",
      sensitivity: "internal",
      capturedAt: "2026-06-29T10:00:00.000Z",
      checksum: "sha256:chunk"
    },
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z",
    ...overrides
  };
}

function createRecordingRepository() {
  const commits: CommitBrainInput[] = [];

  return {
    commits,
    repository: {
      async commitBrain(input: CommitBrainInput) {
        commits.push(input);
        const createdAt = "2026-06-29T10:00:00.000Z";
        const atom: KnowledgeAtom = {
          id: `atom_${commits.length}`,
          tenantId: "tenant_demo",
          title: input.title,
          body: input.body,
          atomType: input.atomType ?? "claim",
          tier: input.tier ?? "team",
          ownerId: input.ownerId ?? input.principalId ?? "usr_admin",
          sourceIds: input.sourceIds ?? [],
          acl: input.acl ?? {
            teams: ["platform"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal"
          },
          status: "candidate",
          version: 1,
          confidence: input.confidence ?? 0.62,
          freshness: input.freshness ?? 1,
          reviewDueAt: "2026-07-06T10:00:00.000Z",
          createdAt,
          updatedAt: createdAt,
          tags: input.tags ?? ["candidate"]
        };
        const changeset: Changeset = {
          id: `cs_${commits.length}`,
          tenantId: "tenant_demo",
          title: `Promote ${input.title}`,
          targetType: "atom",
          targetId: atom.id,
          tier: atom.tier,
          authorId: input.principalId ?? "usr_admin",
          ownerId: atom.ownerId,
          reviewers: input.reviewers ?? ["usr_reviewer"],
          status: input.changesetStatus ?? "review",
          checks: input.reviewChecks ?? [],
          summary: input.changesetSummary ?? "Candidate extraction.",
          createdAt,
          updatedAt: createdAt
        };
        return {
          atom,
          changeset,
          event: {
            id: `evt_${commits.length}`,
            tenantId: "tenant_demo",
            actorId: input.principalId ?? "usr_admin",
            action: "changeset.open" as const,
            targetId: changeset.id,
            targetType: "changeset" as const,
            policyDecision: "allow" as const,
            metadata: {},
            createdAt
          }
        };
      }
    }
  };
}

describe("candidate extraction worker", () => {
  it("extracts typed candidates from actionable processed chunks", async () => {
    const chunks = [
      chunk({ id: "src_artifact_1:chunk:decision", text: "Decision: the platform team approved Composio for connector execution." }),
      chunk({ id: "src_artifact_1:chunk:procedure", text: "Procedure: when a connector fails, check scopes, replay the checkpoint, and notify the owner." }),
      chunk({ id: "src_artifact_1:chunk:policy", text: "Policy: restricted customer data must stay inside the regulated brain tier." }),
      chunk({ id: "src_artifact_1:chunk:lesson", text: "Lesson learned: stale onboarding notes caused bad answers, so review them weekly." }),
      chunk({ id: "src_artifact_1:chunk:claim", text: "The onboarding dashboard uses Slack handoff artifacts as source evidence." })
    ];
    const processingStore = createProcessingStore(chunks);
    const extractionStore = createExtractionStore();
    const recording = createRecordingRepository();
    const worker = createCandidateExtractionWorker({
      artifactProcessing: { getState: () => processingStore.read().then((state) => state!) },
      repository: recording.repository,
      store: extractionStore,
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const run = await worker.run({ artifactIds: ["src_artifact_1"], artifacts: [artifact()] });

    expect(run.candidates).toHaveLength(5);
    expect(run.candidates.map((candidate) => candidate.atom.atomType)).toEqual(
      expect.arrayContaining(["decision", "procedure", "policy", "lesson", "claim"])
    );
    expect(run.candidates[0].sourceEvidence).toMatchObject({
      artifactId: "src_artifact_1",
      provenanceUrl: "https://slack.example.com/archives/C123/p1",
      checksum: "sha256:chunk"
    });
    expect(run.run).toMatchObject({
      status: "completed",
      candidateCount: 5,
      skippedChunkCount: 0
    });
  });

  it("does not open changesets for non-actionable chunks", async () => {
    const processingStore = createProcessingStore([chunk({ text: "ok thanks", offsetEnd: 9 })]);
    const recording = createRecordingRepository();
    const worker = createCandidateExtractionWorker({
      artifactProcessing: { getState: () => processingStore.read().then((state) => state!) },
      repository: recording.repository,
      store: createExtractionStore()
    });

    const run = await worker.run({ artifactIds: ["src_artifact_1"] });

    expect(run.candidates).toHaveLength(0);
    expect(recording.commits).toHaveLength(0);
    expect(run.run).toMatchObject({
      status: "completed",
      candidateCount: 0,
      skippedChunkCount: 1
    });
  });

  it("assigns owners from source context, domain rules, and fallback defaults", async () => {
    const processingStore = createProcessingStore([
      chunk({ id: "src_artifact_1:chunk:source", text: "Decision: source owner should own this connector memory." }),
      chunk({ id: "src_artifact_2:chunk:security", artifactId: "src_artifact_2", text: "Policy: security review is required for restricted exports." }),
      chunk({ id: "src_artifact_3:chunk:fallback", artifactId: "src_artifact_3", text: "Procedure: rotate the dashboard owner when the previous owner leaves." })
    ]);
    const recording = createRecordingRepository();
    const worker = createCandidateExtractionWorker({
      artifactProcessing: { getState: () => processingStore.read().then((state) => state!) },
      repository: recording.repository,
      store: createExtractionStore(),
      ownerRules: [
        {
          id: "security",
          match: /security|restricted/i,
          ownerId: "usr_security",
          reviewers: ["usr_security_reviewer"],
          tier: "department"
        }
      ],
      fallbackOwnerId: "usr_default_owner",
      fallbackReviewers: ["usr_default_reviewer"]
    });

    const run = await worker.run({ artifacts: [artifact()] });

    expect(run.candidates.map((candidate) => candidate.atom.ownerId)).toEqual([
      "usr_source_owner",
      "usr_security",
      "usr_default_owner"
    ]);
    expect(run.candidates[1].changeset.reviewers).toEqual(["usr_security_reviewer"]);
    expect(run.candidates[1].atom.tier).toBe("department");
    expect(run.candidates[2].changeset.reviewers).toEqual(["usr_default_reviewer"]);
  });

  it("opens low-confidence candidates as blocked changesets with review checks", async () => {
    const processingStore = createProcessingStore([
      chunk({ text: "Maybe I think this should probably be a policy if someone agrees." })
    ]);
    const recording = createRecordingRepository();
    const worker = createCandidateExtractionWorker({
      artifactProcessing: { getState: () => processingStore.read().then((state) => state!) },
      repository: recording.repository,
      store: createExtractionStore()
    });

    const run = await worker.run({ artifactIds: ["src_artifact_1"] });

    expect(run.candidates[0].atom.confidence).toBeLessThan(0.55);
    expect(run.candidates[0].changeset.status).toBe("blocked");
    expect(run.candidates[0].changeset.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "check_confidence",
          status: "failed"
        })
      ])
    );
  });

  it("propagates ACL, source ids, provenance tags, and sensitivity to candidate atoms", async () => {
    const processingStore = createProcessingStore([
      chunk({
        text: "Decision: the enterprise team approved the private customer renewal process.",
        acl: {
          teams: ["enterprise"],
          roles: ["admin", "reviewer"],
          sensitivity: "confidential"
        },
        classifiedSensitivity: "confidential"
      })
    ]);
    const recording = createRecordingRepository();
    const worker = createCandidateExtractionWorker({
      artifactProcessing: { getState: () => processingStore.read().then((state) => state!) },
      repository: recording.repository,
      store: createExtractionStore()
    });

    const run = await worker.run({ artifactIds: ["src_artifact_1"] });

    expect(run.candidates[0].atom).toMatchObject({
      sourceIds: ["src_artifact_1"],
      acl: {
        teams: ["enterprise"],
        roles: ["admin", "reviewer"],
        sensitivity: "confidential"
      },
      tags: expect.arrayContaining(["source-linked", "connector:slack", "chunk:src_artifact_1:chunk:0"])
    });
    expect(run.candidates[0].sourceEvidence.excerpt).toContain("private customer renewal");
  });

  it("creates reviewable changesets whose proposed atom content can be edited before merge", async () => {
    const processingStore = createProcessingStore([
      chunk({ text: "Decision: the support team approved weekly customer handoff audits." })
    ]);
    const repository = createSeedRepository();
    const worker = createCandidateExtractionWorker({
      artifactProcessing: { getState: () => processingStore.read().then((state) => state!) },
      repository,
      store: createExtractionStore(),
      now: () => "2026-06-29T10:00:00.000Z"
    });

    const run = await worker.run({ artifacts: [artifact()], principalId: "usr_admin" });
    const response = await repository.reviewMemoryChangeset({
      changesetId: run.candidates[0].changeset.id,
      reviewerId: "usr_reviewer",
      action: "request-changes",
      note: "Make the source-backed wording clearer.",
      editedTitle: "Weekly support handoff audits",
      editedBody: "The support team approved weekly customer handoff audits after reviewing source evidence."
    });

    expect(response.atom).toMatchObject({
      title: "Weekly support handoff audits",
      body: "The support team approved weekly customer handoff audits after reviewing source evidence.",
      status: "candidate"
    });
    expect(response.changeset.status).toBe("blocked");
  });
});
