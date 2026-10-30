/**
 * db-smoke.ts — throwaway verification script (not application code).
 *
 * Proves the schema → TypeScript derivation works end to end.
 *
 * RUN IT:
 *   docker compose --profile tools run --rm migrator \
 *     sh -c 'NODE_OPTIONS="--conditions=react-server" npx tsx db-smoke.ts'
 *
 * Two flags in that command are load-bearing, and worth understanding:
 *
 * 1. `--conditions=react-server`
 *    `src/db/client.ts` imports "server-only", whose package.json does:
 *        "exports": { ".": { "react-server": "./empty.js",
 *                            "default":      "./index.js" } }
 *    Next.js compiles Server Components WITH the react-server condition, so
 *    the import resolves to a 0-byte no-op. Plain `node`/`tsx` don't set it,
 *    so you get index.js, which throws. Same import, two resolutions —
 *    decided by a compiler flag, not by the code.
 *
 * 2. `tsx` (not `node`)
 *    Node strips types fine, but it does NOT resolve tsconfig `paths`.
 *    The `@/*` alias exists only inside Next's bundler. tsx reads tsconfig,
 *    so it can. (This script uses relative imports anyway; the alias would
 *    recurse back into src/db/client.ts → @/env.)
 */
import { eq } from "drizzle-orm";
import { db, pg } from "./src/db/client";
import { notes } from "./src/db/schema";
import type { Note, NewNote } from "./src/db/schema";

async function main() {
  // ── 1. INSERT: the INSERT type and the SELECT type are NOT the same ────────
  //
  // NewNote = InferInsertModel<notes>  → id/createdAt/updatedAt are OPTIONAL
  //                                      (the DB supplies them via DEFAULT),
  //                                      title is REQUIRED (.notNull(), no default).
  //
  // Uncomment the next line and `tsc --noEmit` fails with:
  //   "Property 'title' is missing in type '{ content: string; }'"
  //
  //   const bad: NewNote = { content: "no title" };
  //
  const draft: NewNote = {
    title: "Learn Drizzle",
    content: "SQL-first: the schema IS TypeScript.",
    color: "blue",
  };

  const [inserted] = await db.insert(notes).values(draft).returning();
  console.log("INSERTED :", inserted.title, "| id:", inserted.id);

  // ── 2. SELECT: Note = InferSelectModel<notes> → every column, non-null ────
  const all: Note[] = await db.select().from(notes);
  console.log("ROW COUNT :", all.length);
  for (const n of all) {
    // n.color is the enum union, n.createdAt a real Date. Fully typed.
    console.log(`   - [${n.color}] ${n.title} (pinned=${n.pinned}) @ ${n.createdAt.toISOString()}`);
  }

  // ── 3. The ENUM is enforced by POSTGRES, not just by the compiler ─────────
  try {
    await pg`update notes set color = 'orange' where id = ${inserted.id}`;
    console.log("ENUM      : 'orange' accepted — THIS SHOULD NOT HAVE HAPPENED");
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.log("ENUM      : rejected by Postgres, code", err.code, "(22P02 = invalid input syntax)");
  }

  // ── 4. eq() for predicates, pg for raw SQL ────────────────────────────────
  // NOTE THE NAMESPACES, because mixing them up is a silent runtime bug:
  //   eq()  → drizzle-orm, returns a SQL FRAGMENT (a value you compose)
  //   pg    → postgres.js, EXECUTES (returns a Promise)
  // Using the postgres tag inside .where() compiles & typechecks, then binds
  // the Promise itself as a parameter. That's why the raw client is exported
  // as `pg`, not `sql`.
  const [updated] = await db
    .update(notes)
    .set({ pinned: true })
    .where(eq(notes.id, inserted.id))
    .returning();

  console.log("PINNED    :", updated.pinned);
  console.log("$onUpdate : updatedAt bumped =",
    updated.updatedAt.getTime() > inserted.updatedAt.getTime());

  // ── 5. Idempotent cleanup ─────────────────────────────────────────────────
  await pg`delete from notes where id = ${inserted.id}`;
  console.log("REMAINING :", (await db.select().from(notes)).length);

  await pg.end();
}

main().catch(async (e) => {
  console.error("SMOKE TEST FAILED:", e);
  await pg.end();
  process.exit(1);
});
