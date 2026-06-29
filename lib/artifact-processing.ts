import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NormalizedComposioArtifact } from "./composio-ingestion";
import type { Sensitivity } from "./types";

export type ProcessingStage = "parse" | "chunk" | "classify" | "embed" | "index";

export type ProcessingRecord = {
  artifactId: string;
  connector: string;
  status: "processing" | "indexed" | "failed";
  stage: ProcessingStage;
  version: number;
  retryable: boolean;
  failureReason?: string;
  chunkCount: number;
  updatedAt: string;
};

export type ArtifactChunk = {
  id: string;
  artifactId: string;
  connector: string;
  chunkIndex: number;
  text: string;
  offsetStart: number;
  offsetEnd: number;
  provenanceUrl: string;
  acl: NormalizedComposioArtifact["acl"];
  classifiedSensitivity: Sensitivity;
  promptInjectionRisk: "low" | "medium" | "high";
  lineageChecksum: string;
};

export type FullTextEntry = {
  chunkId: string;
  artifactId: string;
  tokens: string[];
};

export type VectorEntry = {
  chunkId: string;
  artifactId: string;
  embedding: number[];
};

export type ArtifactProcessingState = {
  records: ProcessingRecord[];
  chunks: ArtifactChunk[];
  fullTextIndex: FullTextEntry[];
  vectorIndex: VectorEntry[];
};

export type ArtifactProcessingStore = {
  read(): Promise<ArtifactProcessingState | null>;
  write(state: ArtifactProcessingState): Promise<void>;
};

type PipelineOptions = {
  store?: ArtifactProcessingStore;
  chunkSize?: number;
  now?: () => string;
  embed?: (texts: string[]) => Promise<number[][]>;
};

const supportedMimeTypes = new Set(["text/plain", "text/markdown", "application/json"]);

function defaultState(): ArtifactProcessingState {
  return {
    records: [],
    chunks: [],
    fullTextIndex: [],
    vectorIndex: []
  };
}

function defaultStatePath() {
  return process.env.ARTIFACT_PROCESSING_STATE_PATH ?? join(process.cwd(), "data", "artifact-processing-state.json");
}

function createFileStore(path = defaultStatePath()): ArtifactProcessingStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ArtifactProcessingState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function deterministicEmbedding(texts: string[]) {
  return texts.map((text) => {
    const words = tokenize(text);
    return [
      Math.min(1, text.length / 1000),
      Math.min(1, words.length / 200),
      words.filter((word) => word.length > 6).length / Math.max(1, words.length)
    ];
  });
}

function tokenize(text: string) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
}

function isSupported(artifact: NormalizedComposioArtifact) {
  const mimeType = typeof artifact.raw.mimeType === "string" ? artifact.raw.mimeType : undefined;
  if (!mimeType) {
    return true;
  }
  return supportedMimeTypes.has(mimeType) || mimeType.startsWith("application/vnd.google-apps");
}

function safeFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : "Processing failed.";
  return message.split(":")[0].trim();
}

function sensitivityFor(text: string, fallback: Sensitivity): Sensitivity {
  if (/(password|secret|token|ssn|social security|api key)/i.test(text)) {
    return "restricted";
  }
  if (/(customer list|confidential|private)/i.test(text)) {
    return fallback === "restricted" ? "restricted" : "confidential";
  }
  return fallback;
}

function promptRiskFor(text: string): ArtifactChunk["promptInjectionRisk"] {
  if (/(ignore previous instructions|exfiltrate|system prompt|developer message)/i.test(text)) {
    return "high";
  }
  if (/(ignore instructions|jailbreak|prompt injection)/i.test(text)) {
    return "medium";
  }
  return "low";
}

function splitIntoChunks(text: string, chunkSize: number) {
  const chunks: Array<{ text: string; offsetStart: number; offsetEnd: number }> = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const chunkText = text.slice(offset, offset + chunkSize);
    chunks.push({ text: chunkText, offsetStart: offset, offsetEnd: offset + chunkText.length });
  }
  return chunks.length > 0 ? chunks : [{ text: "", offsetStart: 0, offsetEnd: 0 }];
}

function removeArtifact(state: ArtifactProcessingState, artifactId: string) {
  state.chunks = state.chunks.filter((chunk) => chunk.artifactId !== artifactId);
  state.fullTextIndex = state.fullTextIndex.filter((entry) => entry.artifactId !== artifactId);
  state.vectorIndex = state.vectorIndex.filter((entry) => entry.artifactId !== artifactId);
}

export function createArtifactProcessingPipeline(options: PipelineOptions = {}) {
  const store = options.store ?? createFileStore();
  const chunkSize = options.chunkSize ?? 1200;
  const now = options.now ?? (() => new Date().toISOString());
  const embed = options.embed ?? (async (texts: string[]) => deterministicEmbedding(texts));

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ArtifactProcessingState) {
    await store.write(state);
  }

  function upsertRecord(state: ArtifactProcessingState, record: ProcessingRecord) {
    state.records = [record, ...state.records.filter((candidate) => candidate.artifactId !== record.artifactId)];
  }

  async function fail(state: ArtifactProcessingState, record: ProcessingRecord, stage: ProcessingStage, error: unknown) {
    const failed = {
      ...record,
      status: "failed" as const,
      stage,
      retryable: true,
      failureReason: safeFailureReason(error),
      updatedAt: now()
    };
    upsertRecord(state, failed);
    await save(state);
  }

  return {
    async getState() {
      return load();
    },

    async processArtifact(artifact: NormalizedComposioArtifact) {
      const state = await load();
      const previous = state.records.find((record) => record.artifactId === artifact.id);
      const record: ProcessingRecord = {
        artifactId: artifact.id,
        connector: artifact.connector,
        status: "processing",
        stage: "parse",
        version: (previous?.version ?? 0) + 1,
        retryable: false,
        chunkCount: 0,
        updatedAt: now()
      };

      try {
        upsertRecord(state, record);
        removeArtifact(state, artifact.id);
        if (!isSupported(artifact)) {
          throw new Error(`Unsupported artifact format ${String(artifact.raw.mimeType)}.`);
        }

        record.stage = "chunk";
        const rawChunks = splitIntoChunks(artifact.normalizedText, chunkSize);

        record.stage = "classify";
        const chunks: ArtifactChunk[] = rawChunks.map((chunk, index) => ({
          id: `${artifact.id}:chunk:${index}`,
          artifactId: artifact.id,
          connector: artifact.connector,
          chunkIndex: index,
          text: chunk.text,
          offsetStart: chunk.offsetStart,
          offsetEnd: chunk.offsetEnd,
          provenanceUrl: artifact.provenanceUrl,
          acl: artifact.acl,
          classifiedSensitivity: sensitivityFor(chunk.text, artifact.acl.sensitivity),
          promptInjectionRisk: promptRiskFor(chunk.text),
          lineageChecksum: artifact.checksum
        }));

        record.stage = "embed";
        const embeddings = await embed(chunks.map((chunk) => chunk.text));

        record.stage = "index";
        state.chunks.unshift(...chunks);
        state.fullTextIndex.unshift(
          ...chunks.map((chunk) => ({
            chunkId: chunk.id,
            artifactId: artifact.id,
            tokens: tokenize(chunk.text)
          }))
        );
        state.vectorIndex.unshift(
          ...chunks.map((chunk, index) => ({
            chunkId: chunk.id,
            artifactId: artifact.id,
            embedding: embeddings[index] ?? []
          }))
        );

        const indexed = {
          ...record,
          status: "indexed" as const,
          stage: "index" as const,
          retryable: false,
          failureReason: undefined,
          chunkCount: chunks.length,
          updatedAt: now()
        };
        upsertRecord(state, indexed);
        await save(state);
        return { record: indexed, chunks };
      } catch (error) {
        await fail(state, record, record.stage, error);
        throw error;
      }
    }
  };
}

export const artifactProcessingPipeline = createArtifactProcessingPipeline();
