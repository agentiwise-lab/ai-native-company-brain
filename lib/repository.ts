import { createPostgresRepository } from "./postgres-repository";
import type { BrainRepository } from "./repository-contract";
import { createSeedRepository } from "./seed-repository";

function shouldUseSeedRepository() {
  return process.env.COMPANY_BRAIN_REPOSITORY === "seed" || !process.env.DATABASE_URL;
}

export function createRepository(): BrainRepository {
  if (shouldUseSeedRepository()) {
    return createSeedRepository();
  }

  return createPostgresRepository({
    connectionString: process.env.DATABASE_URL,
    tenantId: process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo"
  });
}

export type { BrainRepository } from "./repository-contract";

export const repository = createRepository();
