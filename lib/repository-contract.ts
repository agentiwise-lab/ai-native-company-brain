import type {
  BrainEvent,
  BrainQueryResult,
  BrainTier,
  Changeset,
  CronJobDefinition,
  CronRun,
  DashboardSnapshot,
  DependencyEdge,
  KnowledgeAtom,
  Principal,
  RegistryItem,
  RegistryKind
} from "./types";

export type CommitBrainInput = {
  title: string;
  body: string;
  tier?: BrainTier;
  principalId?: string;
};

export type CreateRegistryChangesetInput = {
  title: string;
  targetId: string;
  principalId?: string;
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

export type BrainRepository = {
  dashboard(): Promise<DashboardSnapshot>;
  principal(id?: string): Promise<Principal>;
  queryBrain(query: string, principalId?: string, requestedTier?: BrainTier): Promise<BrainQueryResult>;
  commitBrain(input: CommitBrainInput): Promise<{ atom: KnowledgeAtom; changeset: Changeset }>;
  lineage(atomId: string): Promise<LineageResult>;
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
