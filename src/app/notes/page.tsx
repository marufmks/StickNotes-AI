import { Suspense } from "react";
import { listNotes, getNoteStats } from "@/db/queries";
import { NoteForm } from "./note-form";
import { NoteCard } from "./note-card";

/**
 * /notes — a SERVER COMPONENT page.
 *
 * This file is only possible because of the App Router mental model: it can
 * `await` the database directly. There is no API route, no useEffect, no
 * loading state managed with useState, and no client-side fetch waterfall.
 * The SQL runs before this HTML is ever sent.
 *
 * WHAT SHIPS TO THE BROWSER: the rendered HTML, plus the JS for NoteForm
 * (the one "use client" component). NoteCard, the page, the queries — none of
 * it ships. That's the payoff.
 */

/**
 * The list is its own async component so it can be streamed.
 *
 * Why not just `await listNotes()` at the top of the page? Because of
 * `cacheComponents: true` in next.config.ts: uncached async work must sit
 * behind a <Suspense> boundary. This isn't stylistic — without it the build
 * fails. Splitting the component is how you satisfy that constraint while
 * still rendering the form (instant) before the query resolves.
 */
async function NoteList() {
  const notes = await listNotes();

  if (notes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-zinc-500">
        No notes yet. Add your first one above.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {notes.map((note) => (
        /*
         * `key` must be the stable database id, never the array index.
         * React uses the key to decide which DOM nodes to reuse; an index key
         * makes React reuse the WRONG node when the list reorders (and ours
         * does — pinned notes jump to the top). Symptom: text appearing in the
         * wrong card. This is the same rule as React you already know.
         */
        <li key={note.id}>
          <NoteCard note={note} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Cached stats — the CONTRAST to the list above.
 *
 * `getNoteStats()` opts into `"use cache"`, so it does NOT need a Suspense
 * boundary; its value is served from Next's cache and revalidated when
 * actions call revalidatePath("/notes"). Note the difference in shape:
 *
 *   cached      → await directly in the page
 *   uncached    → must be wrapped in <Suspense>
 *
 * When you get this wrong with cacheComponents enabled, the error is at build
 * time and it names the offending data access — which is much better than
 * discovering a stale-render bug in production.
 */
async function Stats() {
  const { total, pinned } = await getNoteStats();
  return (
    <p className="text-sm text-zinc-500">
      {total} note{total === 1 ? "" : "s"} · {pinned} pinned
    </p>
  );
}

/**
 * `export default async function` — the page itself is allowed to be async in
 * the App Router. That's a Server Component-only privilege. An async Client
 * Component does not exist conceptually: `"use client"` + `async` is an error.
 */
export default async function NotesPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">StickyNotes AI</h1>
          {/*
            Suspense here is for STREAMING, not for hiding errors. The fallback
            arrives immediately; <Stats> replaces it when the (cached) query
            resolves. Users see a complete shell instantly.
          */}
          <Suspense fallback={<p className="text-sm text-zinc-400">Loading stats…</p>}>
            <Stats />
          </Suspense>
        </div>
      </header>

      {/* The form is a Client Component, imported into a Server parent. That
          direction is allowed and is the normal composition. */}
      <NoteForm />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your notes
        </h2>
        {/*
          The uncached list streams in behind this boundary. Two separate
          Suspense boundaries (stats + list) mean a slow list never blocks the
          stats, and vice versa — each piece of the page is independently
          streamed.
        */}
        <Suspense
          fallback={
            <div className="flex flex-col gap-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg border bg-zinc-100 dark:bg-zinc-900" />
              ))}
            </div>
          }
        >
          <NoteList />
        </Suspense>
      </section>
    </main>
  );
}
