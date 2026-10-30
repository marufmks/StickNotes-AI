"use client";

import { useActionState } from "react";
import { createNote } from "@/app/notes/actions";
import { initialNoteState, type NoteActionState } from "@/app/notes/schema";
import { noteColorEnum } from "@/db/schema";

/**
 * THE ONLY "use client" IN THE FEATURE.
 *
 * Why this component and not the page: the page only formats data it already
 * received from the DB, so it can stay a Server Component (zero JS shipped).
 * This form needs *state* — pending, field errors, resetting after success —
 * and state requires the browser. So the client boundary is pushed as far
 * DOWN the tree as possible, wrapping only the interactive part.
 *
 * That's the core discipline of the App Router: push "use client" down, not up.
 * A common beginner mistake is marking the page "use client" to get a form
 * working, which silently makes the whole page client-rendered and defeats
 * the data layer.
 */

export function NoteForm() {
  /**
   * useActionState (React 19) replaces the older useFormState.
   *
   * Returns a 3-tuple:
   *   [0] state   — whatever your action returned (typed as NoteActionState)
   *   [1] action  — pass to <form action={...}>
   *   [2] pending — true while the action is in flight
   *
   * The generic is inferred from `createNote`'s signature plus the initial
   * state, so `state.status` is a checked union — no stringly-typed matching.
   */
  const [state, formAction, pending] = useActionState<NoteActionState, FormData>(
    createNote,
    initialNoteState,
  );

  /**
   * NOTE: the form is NOT controlled. There is no useState per field and no
   * onChange. The browser owns the input values; React sends them as FormData.
   *
   * This is the big departure from the React you know. In a SPA you'd
   * `useState` every field, build a JSON body, fetch('/api/notes'), then
   * manually refetch. Here the DOM is the source of truth for the duration of
   * the submit, and the server re-renders the list. Less code, fewer bugs,
   * and it works without JS.
   *
   * The tradeoff: you lose per-keystroke reactivity. If you need live
   * character counts or instant validation, THAT is when a controlled input
   * (and therefore client state) earns its place.
   */
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder="What's on your mind?"
          className="rounded border px-3 py-2 text-sm"
          /**
           * aria-invalid + aria-describedby wire the error to the input for
           * screen readers. Server-side validation that isn't announced is
           * validation that half your users never see.
           */
          aria-invalid={Boolean(state.fieldErrors?.title)}
          aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
        />
        {state.fieldErrors?.title && (
          <p id="title-error" role="alert" className="text-xs text-red-600">
            {state.fieldErrors.title.join(", ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="content" className="text-sm font-medium">
          Note
        </label>
        <textarea
          id="content"
          name="content"
          rows={3}
          placeholder="Details…"
          className="rounded border px-3 py-2 text-sm"
        />
        {state.fieldErrors?.content && (
          <p role="alert" className="text-xs text-red-600">
            {state.fieldErrors.content.join(", ")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="color" className="text-sm font-medium">
            Color
          </label>
          {/*
           * Options come from the pgEnum, so the dropdown can never offer a
           * value the database would reject. One schema, one source of truth.
           */}
          <select id="color" name="color" defaultValue="yellow" className="rounded border px-2 py-1 text-sm">
            {noteColorEnum.enumValues.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/*
         * A checkbox sends "on" when checked and NOTHING when unchecked.
         * Our zod schema coerces that correctly — this is the field that
         * silently breaks if you assume `false` is sent.
         */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pinned" />
          Pin to top
        </label>
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-sm text-green-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Saving…" : "Add note"}
      </button>
    </form>
  );
}
