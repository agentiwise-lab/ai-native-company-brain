import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const dryRun = process.argv.includes("--dry-run");
const schemaPath = resolve(process.cwd(), "db", "schema.sql");

async function main() {
  const schema = await readFile(schemaPath, "utf8");

  if (dryRun) {
    console.log(`Loaded ${schema.length} bytes from ${schemaPath}`);
    console.log("Dry run complete. Set DATABASE_URL and run npm run db:migrate to apply.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(schema);
    console.log("Database migration complete.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
