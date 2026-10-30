import "server-only";
import { cacheLife } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notes, type Note } from "@/db/schema";

/**
 * THE READ LAYER.
 *
 * This file only ever runs on the server: it imports the DB client, which is
 * guarded by "server-only". A Client Component importing it fails the build.
 *
 * WHY A SEPARATE MODULE RATHER THAN QUERYING INLINE IN THE PAGE?
 *
 * Because in the App Router, a page is a component AND a data boundary. If you
 * put `db.select()` directly in page.tsx you can't reuse it, can't test it,
 * and can't tell at a glance which routes touch the database. This module is
 * the seam — the equivalent of a PHP repository class, but typed end to end.
 *
 * NOTE ON `cacheComponents: true` — this project has it ENABLED. That means:
 *   - uncached async work must be wrapped in <Suspense> at the page level
 *   - or the function can opt into caching with "use cache"
 *
 * We deliberately do NOT cache these reads: a notes app must show what the
 * user just wrote. The page wraps them in <Suspense>, which is the documented
 * pattern for "fresh data on every request".
 */

/**
 * All notes, pinned first, then newest.
 *
 * The return type is the inferred `Note` row type — no hand-written DTO, so
 * adding a column to the schema flows through to every consumer.
 *
 * `desc(notes.pinned)` sorts booleans: Postgres orders false < true, so DESC
 * puts pinned notes on top. Two-key ordering is a deliberate tiebreaker; with
 * a single key, equal timestamps would produce flickering order between
 * renders (non-deterministic ordering is a classic list-rendering bug).
 */
export async function listNotes(): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .orderBy(desc(notes.pinned), desc(notes.createdAt));
}

/**
 * A single note, or `null` if it doesn't exist.
 *
 * `null` rather than throwing: "not found" is an expected outcome for a
 * user-supplied UUID in a URL, not an exceptional one. The page turns it into
 * Next's `notFound()`, which renders the nearest not-found.tsx. Throwing from
 * here would surface as a 500 instead of a 404 — a real difference in
 * observability and SEO.
 *
 * `limit(1)` + destructuring is explicit about cardinality. `db.select()`
 * returning an array forces the caller to index into it, which hides the
 * "empty" case behind `undefined`.
 */
export async function getNoteById(id: string): Promise<Note | null> {
  const rows = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Aggregate stats — the "cached" counter-example.
 *
 * Added specifically to show the OTHER side of cacheComponents: this data is
 * expensive-ish and tolerance for staleness is high, so it opts into caching.
 *
 * Walk through what "use cache" does:
 *   - the return value is stored in Next's cache, keyed by function arguments
 *   - subsequent requests reuse it until revalidated (see cacheLife below)
 *   - mutations must call revalidatePath/revalidateTag to invalidate it
 *
 * It must be an async function: the cache stores a promise's resolved value.
 */
export async function getNoteStats() {
  "use cache";
  /**
   * `cacheLife("minutes")` sets a short staleness window. Without it, "use
   * cache" would use the default profile, which is far too long for a counter
   * that should feel live-ish. Naming a profile beats a raw number: the
   * profiles are tuned by the framework.
   */
  cacheLife("minutes");

  const all = await db.select().from(notes);
  return {
    total: all.length,
    pinned: all.filter((n) => n.pinned).length,
  };
}
