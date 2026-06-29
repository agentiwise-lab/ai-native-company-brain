import { canReadAtom } from "./policy";
import { brainTiers, type BrainTier, type DependencyEdge, type KnowledgeAtom, type Principal } from "./types";

export type RetrievalFactors = {
  lexical: number;
  vector: number;
  metadata: number;
  graph: number;
  tierAuthority: number;
  freshness: number;
  confidence: number;
  status: number;
};

export type RetrievalRanking = {
  atomId: string;
  score: number;
  factors: RetrievalFactors;
};

export type DeniedRetrievalCandidate = {
  atom: KnowledgeAtom;
  score: number;
  factors: RetrievalFactors;
  policy: {
    allowed: false;
    reason: string;
  };
};

export type HybridRetrievalResult = {
  citations: KnowledgeAtom[];
  rankings: RetrievalRanking[];
  denied: DeniedRetrievalCandidate[];
  explanation: string;
};

type RankInput = {
  query: string;
  principal: Principal;
  atoms: KnowledgeAtom[];
  edges?: DependencyEdge[];
  requestedTier?: BrainTier;
  limit?: number;
};

type ScoredAtom = {
  atom: KnowledgeAtom;
  score: number;
  factors: RetrievalFactors;
  matched: boolean;
};

const tierAuthority = new Map<BrainTier, number>(
  brainTiers.map((tier, index) => [tier, Number(((index + 1) / brainTiers.length).toFixed(2))])
);

const statusScore: Record<KnowledgeAtom["status"], number> = {
  approved: 1,
  candidate: 0.68,
  stale: 0.24,
  superseded: 0.12,
  rejected: 0
};

const semanticExpansions: Record<string, string[]> = {
  ai: ["agent", "automation"],
  agent: ["mcp", "tool", "skill"],
  brain: ["memory", "knowledge", "atom"],
  connector: ["composio", "source", "artifact", "integration"],
  cron: ["schedule", "scheduled", "job"],
  evidence: ["source", "citation", "snippet"],
  memory: ["brain", "knowledge", "atom"],
  policy: ["rule", "require", "must", "approval"],
  promotion: ["review", "merge", "changeset", "gate"],
  review: ["approval", "merge", "changeset", "curation"],
  source: ["artifact", "evidence", "citation", "snippet"],
  tool: ["skill", "plugin", "registry"]
};

const queryStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "brain",
  "company",
  "definitely",
  "for",
  "is",
  "memory",
  "not",
  "of",
  "real",
  "the",
  "to"
]);

function tokens(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function expandQueryTokens(queryTokens: string[]) {
  return unique(queryTokens.flatMap((token) => [token, ...(semanticExpansions[token] ?? [])]));
}

function atomText(atom: KnowledgeAtom) {
  return [atom.title, atom.body, atom.atomType, atom.tier, atom.status, ...atom.tags, ...atom.sourceIds].join(" ");
}

function overlapScore(queryTokens: string[], candidateTokens: string[]) {
  if (queryTokens.length === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  const matched = queryTokens.filter((token) => candidateSet.has(token)).length;
  return Number((matched / queryTokens.length).toFixed(4));
}

function vectorize(candidateTokens: string[]) {
  const vector = Array.from({ length: 24 }, () => 0);
  for (const token of candidateTokens) {
    let hash = 0;
    for (let index = 0; index < token.length; index += 1) {
      hash = (hash * 31 + token.charCodeAt(index)) % vector.length;
    }
    vector[hash] += 1;
  }
  return vector;
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] * a[index];
    bMag += b[index] * b[index];
  }
  if (aMag === 0 || bMag === 0) {
    return 0;
  }
  return Number((dot / (Math.sqrt(aMag) * Math.sqrt(bMag))).toFixed(4));
}

function metadataScore(queryTokens: string[], atom: KnowledgeAtom) {
  const metadataTokens = tokens([atom.atomType, atom.tier, ...atom.tags, ...atom.sourceIds].join(" "));
  return overlapScore(queryTokens, metadataTokens);
}

function graphScore(atom: KnowledgeAtom, edges: DependencyEdge[]) {
  const related = edges.filter((edge) => edge.fromId === atom.id || edge.toId === atom.id);
  if (related.some((edge) => edge.relation === "source" || edge.relation === "depends-on")) {
    return 0.12;
  }
  if (related.length > 0) {
    return 0.06;
  }
  return 0;
}

function scoreAtom(atom: KnowledgeAtom, queryTokens: string[], expandedTokens: string[], queryVector: number[], edges: DependencyEdge[], hasQueryText: boolean): ScoredAtom {
  const candidateTokens = tokens(atomText(atom));
  const lexical = overlapScore(queryTokens, candidateTokens);
  const semantic = overlapScore(expandedTokens, candidateTokens);
  const vector = cosine(queryVector, vectorize(candidateTokens));
  const metadata = metadataScore(expandedTokens, atom);
  const graph = graphScore(atom, edges);
  const freshness = Math.max(0, Math.min(1, atom.freshness));
  const confidence = Math.max(0, Math.min(1, atom.confidence));
  const authority = tierAuthority.get(atom.tier) ?? 0;
  const status = statusScore[atom.status];
  const factors: RetrievalFactors = {
    lexical,
    vector,
    metadata,
    graph,
    tierAuthority: authority,
    freshness,
    confidence,
    status
  };
  const matched = hasQueryText ? queryTokens.length > 0 && (lexical > 0 || semantic >= 0.18 || metadata > 0) : true;
  const relevance = hasQueryText
    ? lexical * 0.34 + semantic * 0.18 + vector * 0.18 + metadata * 0.08 + graph * 0.04
    : 0.35;
  const governance = authority * 0.16 + freshness * 0.1 + confidence * 0.08 + status * 0.04;
  const score = matched ? Number((relevance + governance).toFixed(4)) : 0;

  return { atom, score, factors, matched };
}

function explanationFor(citations: KnowledgeAtom[], rankings: RetrievalRanking[], denied: DeniedRetrievalCandidate[], hasQuery: boolean) {
  if (citations.length === 0) {
    return denied.length > 0
      ? "No accessible memory matched this query after ACL filtering."
      : "No accessible memory matched this query.";
  }

  const top = rankings[0];
  const authority = top ? Math.round(top.factors.tierAuthority * 100) : 0;
  const freshness = top ? Math.round(top.factors.freshness * 100) : 0;
  const confidence = top ? Math.round(top.factors.confidence * 100) : 0;
  const scope = hasQuery ? "query" : "default memory view";
  return `Found ${citations.length} citations for the ${scope}. Ranking used lexical, vector, metadata, graph, tier authority (${authority}), freshness (${freshness}), and confidence (${confidence}).`;
}

export function rankHybridAtoms(input: RankInput): HybridRetrievalResult {
  const hasQueryText = Boolean(input.query.trim());
  const queryTokens = unique(tokens(input.query).filter((token) => !queryStopWords.has(token)));
  const expandedTokens = expandQueryTokens(queryTokens);
  const queryVector = vectorize(expandedTokens);
  const edges = input.edges ?? [];
  const limit = input.limit ?? 5;
  const scopedAtoms = input.atoms.filter((atom) => (input.requestedTier ? atom.tier === input.requestedTier : true));
  const scored = scopedAtoms
    .map((atom) => scoreAtom(atom, queryTokens, expandedTokens, queryVector, edges, hasQueryText))
    .filter((candidate) => candidate.matched)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (tierAuthority.get(right.atom.tier) ?? 0) - (tierAuthority.get(left.atom.tier) ?? 0);
    });

  const evaluated = scored.map((candidate) => ({ ...candidate, policy: canReadAtom(input.principal, candidate.atom) }));
  const allowed = evaluated.filter((candidate) => candidate.policy.allowed).slice(0, limit);
  const denied = evaluated
    .filter((candidate): candidate is ScoredAtom & { policy: { allowed: false; reason: string } } => !candidate.policy.allowed)
    .map((candidate) => ({
      atom: candidate.atom,
      score: candidate.score,
      factors: candidate.factors,
      policy: candidate.policy
    }));
  const rankings = allowed.map((candidate) => ({
    atomId: candidate.atom.id,
    score: candidate.score,
    factors: candidate.factors
  }));
  const citations = allowed.map((candidate) => candidate.atom);

  return {
    citations,
    rankings,
    denied,
    explanation: explanationFor(citations, rankings, denied, hasQueryText)
  };
}
