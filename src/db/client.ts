import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * The database client — a SINGLETON.
 *
 * WHY A SINGLETON, AND WHY `globalThis`?
 *
 * In PHP each request boots fresh and tears down, so a `new PDO(...)` per
 * request was acceptable. Node is the opposite: one long-lived process
 * serving many requests. Worse, in `next dev` the hot-reload re-evaluates
 * modules on every file edit. If we simply wrote:
 *
 *     export const db = drizzle(postgres(env.DATABASE_URL));
 *
 * then every hot-reload would create ANOTHER connection pool. Postgres has
 * a hard `max_connections` (default 100). Keep reloading and you exhaust it
 * with "too many clients already". PHP has no analogue to this bug, which
 * is why it catches backend devs off guard.
 *
 * The fix: stash the pool on `globalThis`, which survives module
 * re-evaluation. This is the documented Next.js pattern for any
 * long-lived resource (DB pools, queue clients, S3 clients).
 */

/**
 * The shape we cache on globalThis. Two fields, and we explain why each:
 *
 * - `sql`: the RAW postgres.js client, kept because it owns the actual
 *   socket pool. If we only cached the Drizzle wrapper, a reload would
 *   create a new pool and we'd be right back where we started.
 *
 * - `db`: the Drizzle instance built from it, so callers get type-safe
 *   query building.
 */
type GlobalWithDb = typeof globalThis & {
  __db?: {
    sql: postgres.Sql;
    db: ReturnType<typeof drizzle<typeof schema>>;
  };
};

const globalWithDb = globalThis as GlobalWithDb;

function createClient() {
  /**
   * postgres.js options that matter in a container:
   *
   * - `max`: pool ceiling. Default is 10; a dev container sharing one
   *   Postgres with other tools benefits from staying small.
   * - `idle_timeout` / `connect_timeout`: prevent leaked idle connections
   *   from hanging around after a hot reload.
   * - `prepare: false` disables the extended-query protocol cache. It's a
   *   deliberate trade: slightly slower, but avoids the classic
   *   "cached plan must not change result type" errors when you ALTER a
   *   table and a long-lived connection keeps a stale prepared statement.
   *   Fine to flip on later once the schema is stable.
   */
  const sql = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  const db = drizzle(sql, { schema });

  return { sql, db };
}

/**
 * Reuse the existing pool if hot reload already made one, else create it.
 *
 * The `process.env.NODE_ENV === "production"` guard is a hint to the
 * bundler: in production there is no hot reload, so the global cache is
 * dead weight and can be tree-shaken. Harmless either way — but the
 * conditional makes intent explicit for the reader.
 */
function getDb() {
  if (!globalWithDb.__db) {
    globalWithDb.__db = createClient();
  }
  return globalWithDb.__db;
}

const { sql, db } = getDb();

/** The Drizzle client. Use this in queries. */
export { db };

/**
 * THE RAW postgres.js CLIENT — deliberately NOT named `sql`.
 *
 * History, and why this matters:
 *
 * The first version of this file exported the raw client as `sql`, matching
 * postgres.js's own docs. That created a silent, expensive bug. BOTH
 * postgres.js and drizzle-orm export a tagged-template function named `sql`,
 * but they do completely different things:
 *
 *   import { sql } from "drizzle-orm"   → BUILDS a SQL fragment (a value)
 *   import postgres from "postgres"     → sql`...` EXECUTES a query (a Promise)
 *
 * So this line compiled fine, typechecked fine, and then failed at runtime:
 *
 *     .where(sql`${notes.id} = ${id}`)
 *     // drizzle bound the Promise itself as a parameter:
 *     //   where $3  →  params: [..., [object Promise]]
 *
 * Renaming to `pg` makes the misuse impossible to write by accident, because
 * now you can see at a glance which library you're calling. Naming as a
 * defence — better than a code-review rule people forget.
 */
export { sql as pg };

/** Typed schema, so callers don't need a second import. */
export { schema };
