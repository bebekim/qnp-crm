import { execSync } from "node:child_process";
import { join } from "node:path";

const CRM_ROOT = join(__dirname, "../..");
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://nanoclaw_test:nanoclaw_test@localhost:5432/nanoclaw_test";

function run(cmd: string, opts: Record<string, unknown> = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

function psql(sql: string) {
  run(`psql "${TEST_DB_URL}" -c "${sql}"`);
}

export async function setup() {
  // Verify Postgres is reachable
  run(`pg_isready -h localhost -p 5432`);

  // Enable pg_trgm for fuzzy search (requires superuser — may already exist)
  try {
    psql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  } catch {
    // Extension may already exist or require superuser — proceed
  }

  // Push schema via drizzle-kit
  run("npx drizzle-kit push --force", {
    cwd: CRM_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });

  // Create receipt number sequence (not managed by Drizzle)
  psql(
    "CREATE SEQUENCE IF NOT EXISTS qnp_receipt_seq CACHE 1 NO CYCLE;",
  );

  // Export for worker processes
  process.env.DATABASE_URL = TEST_DB_URL;
}

export async function teardown() {
  // Truncate all data but keep the schema for the next run
  psql(
    "TRUNCATE TABLE receipts, donations, contact_org_links, tags, contact_relationships, recurring_donations, organisations, contacts, receipt_config, job_runs, audit_log CASCADE;",
  );
}
