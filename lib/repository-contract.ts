import type {
  BrainEvent,
  BrainQueryResult,
  BrainTier,
  Changeset,
  ChangesetStatus,
  CronJobDefinition,
  CronRun,
  DashboardSnapshot,
  DependencyEdge,
  KnowledgeAtom,
  Principal,
  RegistryItem,
  RegistryKind,
  ReviewCheck
} from "./types";

export type CommitBrainInput = {
  title: string;
  body: string;
  tier?: BrainTier;
  principalId?: string;
  sourceIds?: string[];
  sourceUri?: string;
  sourceTitle?: string;
  atomType?: KnowledgeAtom["atomType"];
  ownerId?: string;
  reviewers?: string[];
  acl?: KnowledgeAtom["acl"];
  confidence?: number;
  freshness?: number;
  tags?: string[];
  changesetSummary?: string;
  changesetStatus?: ChangesetStatus;
  reviewChecks?: ReviewCheck[];
};

export type CreateRegistryChangesetInput = {
  title: string;
  targetId: string;
  principalId?: string;
};

export type ReviewMemoryChangesetInput = {
  changesetId: string;
  reviewerId: string;
  action: "approve" | "reject" | "request-changes";
  note?: string;
  editedTitle?: string;
  editedBody?: string;
};

export type MergeMemoryChangesetInput = {
  changesetId: string;
  reviewerId: string;
  targetTier?: BrainTier;
};

export type LineageResult = {
  atom?: KnowledgeAtom;
  edges: DependencyEdge[];
  events: BrainEvent[];
  sources: string[];
};

export type RegistryPublishResult = {
  item?: RegistryItem;
  published: boolean;
  decision: {
    allowed: boolean;
    reasons: string[];
  };
};

export type RegistryRollbackResult = {
  item?: RegistryItem;
  rolledBack: boolean;
  targetVersion?: string;
};

export type CronRunResult = {
  job?: CronJobDefinition;
  run?: CronRun;
};

export type ReviewMemoryChangesetResult = {
  atom?: KnowledgeAtom;
  changeset: Changeset;
  event: BrainEvent;
};

export type MergeMemoryChangesetResult = {
  atom?: KnowledgeAtom;
  changeset?: Changeset;
  events: BrainEvent[];
  decision: {
    allowed: boolean;
    reasons: string[];
  };
};

export type BrainRepository = {
  dashboard(): Promise<DashboardSnapshot>;
  principal(id?: string): Promise<Principal>;
  queryBrain(query: string, principalId?: string, requestedTier?: BrainTier): Promise<BrainQueryResult>;
  commitBrain(input: CommitBrainInput): Promise<{ atom: KnowledgeAtom; changeset: Changeset; event: BrainEvent }>;
  lineage(atomId: string): Promise<LineageResult>;
  listChangesets(targetType?: "atom" | RegistryKind): Promise<Changeset[]>;
  reviewMemoryChangeset(input: ReviewMemoryChangesetInput): Promise<ReviewMemoryChangesetResult>;
  mergeMemoryChangeset(input: MergeMemoryChangesetInput): Promise<MergeMemoryChangesetResult>;
  searchRegistry(query?: string, kind?: RegistryKind, principalId?: string): Promise<RegistryItem[]>;
  createRegistryChangeset(input: CreateRegistryChangesetInput): Promise<Changeset | null>;
  publishRegistryItem(id: string): Promise<RegistryPublishResult>;
  rollbackRegistryItem(id: string): Promise<RegistryRollbackResult>;
  listCronJobs(): Promise<CronJobDefinition[]>;
  getCronJob(id: string): Promise<CronJobDefinition | undefined>;
  runCronJob(id: string): Promise<CronRunResult>;
  listCronRuns(id: string): Promise<CronRun[]>;
  allRegistry(): Promise<RegistryItem[]>;
  allEvents(): Promise<BrainEvent[]>;
};
