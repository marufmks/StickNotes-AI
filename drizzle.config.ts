import { defineConfig } from "drizzle-kit";

/**
 * drizzle.config.ts — the MIGRATION TOOL's config, not the app's config.
 *
 * CRITICAL DISTINCTION (this is the trap that will bite you):
 *
 * This file is executed by `drizzle-kit`, a plain Node CLI process. It is
 * NOT bundled by Next.js, so it has no Next runtime, no bundler, and no
 * `server-only` support. We verified earlier that importing src/env.ts from
 * plain Node throws:
 *
 *   "This module cannot be imported from a Client Component module."
 *
 * That's not a bug — it's `server-only` doing its job, because in a CLI
 * context there is no "server" vs "client" distinction to enforce.
 *
 * So: read process.env DIRECTLY here, like PHP reading getenv() in a
 * standalone script. The app validates the same variable properly in
 * src/env.ts; this config only needs the one value to generate SQL.
 *
 * The other reason not to import env.ts: this file would then need the
 * whole zod contract to be satisfied just to run a migration, which makes
 * bootstrapping a fresh database needlessly fragile.
 */

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    [
      "DATABASE_URL is not set.",
      "",
      "Run migrations through Compose, which injects it:",
      "  docker compose --profile tools run --rm migrator npm run db:migrate",
      "",
      "Or export it manually if you're running drizzle-kit on the host.",
    ].join("\n"),
  );
}

export default defineConfig({
  // Where `drizzle-kit generate` writes the SQL migration files.
  // These are COMMITTED to git — they're the audit trail of schema changes.
  schema: "./src/db/schema.ts",
  out: "./drizzle",

  // `schema` means the DB is the source of truth for what exists (introspection
  // and migrations both work from it). `db` would read from a live connection.
  dialect: "postgresql",

  // The URL itself. Note we pass it as a string, not a `url()` callback —
  // drizzle-kit can also read DB_URL from the environment if you omit it.
  dbCredentials: {
    url: databaseUrl,
  },

  // `verbose` prints the SQL it's about to run; `strict` makes it refuse to
  // do anything destructive without an explicit flag. Both are what you want
  // while learning — you see the SQL, which is the entire point of Drizzle.
  verbose: true,
  strict: true,
});
