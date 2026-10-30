import Link from "next/link";

/**
 * `/` — a Server Component (default; no "use client").
 *
 * Static markup, so this page is prerendered at build time and served as HTML
 * with essentially no JS. In the Pages Router / SPA world you'd need a router
 * to move to /notes; in the App Router <Link> does client-side navigation
 * automatically, prefetching the target on hover/viewport.
 *
 * The important detail: <Link> is the ONE component in this file that brings
 * client-side behavior, and it does so without turning the page into a Client
 * Component. Framework components can be interactive while your component
 * stays a Server Component.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">StickyNotes AI</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Server Components render this page on the server. The notes list lives
        at <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">/notes</code>,
        where the database is queried directly — no API route involved.
      </p>
      <Link
        href="/notes"
        className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
      >
        Open notes →
      </Link>
    </main>
  );
}
