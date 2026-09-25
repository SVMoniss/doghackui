import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * Lazy PostgreSQL pool for the mesh evidence store (self-host database).
 * Created on first use so imports never open connections at build time.
 */
export function meshPool(): Pool {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Start the self-host database with `docker compose up db`.");
  }
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}
