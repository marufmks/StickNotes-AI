import { togglePinned, deleteNote } from "@/app/notes/actions";
import type { Note } from "@/db/schema";

/**
 * A SERVER COMPONENT by default — no "use client" anywhere in this file.
 *
 * It renders one note card and, crucially, contains two <form> elements whose
 * actions are Server Actions. Because they're plain HTML forms pointing at
 * server endpoints, they work with JavaScript disabled. Progressive
 * enhancement isn't a feature we added; it's the default behavior.
 *
 * NO useState, NO onClick, NO event handlers. If you find yourself wanting
 * onClick in this file, that's the signal you need a small "use client" child
 * — not that this whole component should become client.
 */
export function NoteCard({ note }: { note: Note }) {
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border p-4"
      /**
       * Inline style for the per-note color. A Tailwind class per color would
       * require the class name to exist at build time — dynamic strings like
       * `bg-${note.color}-100` get purged. Inline styles sidestep that, at the
       * cost of not being themeable. Know which tradeoff you're making.
       */
      style={{ borderLeftWidth: 4, borderLeftColor: borderFor(note.color) }}
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">{note.title}</h2>

        {/*
          Bound Server Action. `.bind(null, note.id)` pre-fills the first
          parameter, so the client only supplies what the form carries.
          The id is still untrusted input on the server — bind is a
          convenience, not an authorization mechanism.
        */}
        <form action={togglePinned.bind(null, note.id)}>
          <button
            type="submit"
            className="rounded border px-2 py-1 text-xs"
            aria-label={note.pinned ? "Unpin note" : "Pin note"}
          >
            {note.pinned ? "★ Pinned" : "☆ Pin"}
          </button>
        </form>
      </header>

      {note.content && (
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {note.content}
        </p>
      )}

      <footer className="flex items-center justify-between gap-3 text-xs text-zinc-500">
        {/*
          Dates render on the SERVER. This is an underrated benefit: the HTML
          your browser receives already contains formatted text, so there's no
          layout shift and no hydration mismatch. `toLocaleDateString` in a
          Client Component would format in the user's locale; here it formats
          in the SERVER's locale — a real gotcha. For locale-sensitive display,
          format on the client or pass an explicit locale/timezone.
        */}
        <time dateTime={note.createdAt.toISOString()}>
          {note.createdAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </time>

        <form action={deleteNote}>
          {/* The id travels as a hidden field, so deleteNote reads it from FormData. */}
          <input type="hidden" name="id" value={note.id} />
          <button type="submit" className="text-red-600 hover:underline">
            Delete
          </button>
        </form>
      </footer>
    </article>
  );
}

/**
 * Maps the pgEnum union to a concrete color.
 *
 * TypeScript checks exhaustiveness here: `note.color` is a union of five
 * literals, and the Record must have all five keys. Add "gray" to the pgEnum
 * and this object stops compiling until you handle it — a compile-time
 * reminder instead of a silent missing case.
 */
function borderFor(color: Note["color"]): string {
  const map: Record<Note["color"], string> = {
    yellow: "#eab308",
    pink: "#ec4899",
    blue: "#3b82f6",
    green: "#22c55e",
    purple: "#a855f7",
  };
  return map[color];
}
