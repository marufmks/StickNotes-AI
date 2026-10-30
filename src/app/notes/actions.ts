"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notes } from "@/db/schema";
import {
  noteInputSchema,
  type NoteActionState,
} from "@/app/notes/schema";

/**
 * SERVER ACTIONS.
 *
 * "use server" at the top of the FILE (not inside functions) marks every
 * export as a Server Function. Next replaces each with a POST endpoint and
 * gives the client a reference — the function body never ships to the browser.
 *
 * THE SECURITY RULE THAT MATTERS MOST:
 *
 * These are not "private" functions reachable only through your form. Next's
 * own docs are explicit: Server Functions are reachable via direct POST
 * requests. Anyone can call createNote from curl. Therefore:
 *
 *   1. NEVER trust the client's data  → validate with zod (below)
 *   2. NEVER trust the client's identity → check auth/session (Phase 6)
 *
 * In PHP terms: this is a public controller action. Treat it exactly like one.
 * The "it's only called by my component" assumption is the classic RSC bug.
 */

/**
 * The signature required by React's useActionState:
 *
 *   (prevState, formData) => Promise<newState>
 *
 * `prevState` is the current state from the hook. We don't read it here, but
 * the arity matters — that's how the hook knows this is a reducer-style action.
 * If you omit it, useActionState throws at runtime.
 */
export async function createNote(
  _prevState: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  /**
   * FormData → plain object.
   *
   * `Object.fromEntries(formData)` returns `Record<string, FormDataEntryValue>`
   * which is `string | File`. We hand it straight to zod, which is where the
   * real typing happens. Note what we are NOT doing: casting to NoteInput and
   * trusting it. That cast is the bug that ships.
   */
  const raw = Object.fromEntries(formData);

  /**
   * safeParse, never parse.
   *
   * `parse` throws, which would surface as an unhandled Server Action error
   * and a generic 500 for the user. `safeParse` returns a discriminated union
   * (`{ success: true, data }` | `{ success: false, error }`) that we can turn
   * into a useful form state. This is the TS equivalent of `$validator->fails()`.
   */
  const parsed = noteInputSchema.safeParse(raw);

  if (!parsed.success) {
    /**
     * `.flatten()` gives `{ formErrors, fieldErrors }` keyed by field name —
     * exactly the shape NoteActionState expects, so the form can render
     * messages inline next to the right input.
     */
    const { fieldErrors } = parsed.error.flatten();
    return { status: "invalid", fieldErrors, message: null };
  }

  try {
    /**
     * parsed.data is fully typed as NoteInput. Drizzle then typechecks it
     * against the INSERT type. Two independent guarantees before SQL runs:
     * zod says "this is a valid note", Drizzle says "these columns exist".
     */
    await db.insert(notes).values({
      title: parsed.data.title,
      content: parsed.data.content,
      color: parsed.data.color,
      pinned: parsed.data.pinned,
    });
  } catch (error) {
    /**
     * Don't leak internals. A raw Postgres error can contain column names,
     * constraint names, even fragments of other rows in the message. Log the
     * detail server-side; return something safe to the client.
     */
    console.error("createNote failed:", error);
    return {
      status: "error",
      fieldErrors: null,
      message: "Could not save the note. Please try again.",
    };
  }

  /**
   * REVALIDATION — the part PHP devs forget.
   *
   * Next caches route segments. After a write, the list page would keep
   * serving its cached render, so the user adds a note and doesn't see it.
   * `revalidatePath` marks the route stale so the next request re-renders.
   *
   * Use the LITERAL path, not a template with the id — revalidatePath matches
   * routes, and dynamic segments are covered by revalidating their parent.
   */
  revalidatePath("/notes");

  return { status: "success", fieldErrors: null, message: "Note created." };
}

/**
 * Delete — demonstrates the OTHER way to invoke an action.
 *
 * This one is NOT wrapped in useActionState. It's passed straight to a
 * <form action={...}>, so it keeps the plain `(formData) => void` signature.
 * That's what gives us progressive enhancement: the delete works even with
 * JavaScript disabled, because it's a real HTML form POST.
 *
 * Two action signatures in one file is normal. Pick based on whether the UI
 * needs per-field error state:
 *   - needs validation feedback → useActionState + (prevState, formData)
 *   - fire-and-forget          → plain (formData)
 */
export async function deleteNote(formData: FormData): Promise<void> {
  const id = formData.get("id");

  /**
   * Runtime type check, not a cast. `formData.get` returns
   * `FormDataEntryValue | null` — it can legitimately be a File or missing.
   * Casting to `string` here would send `[object File]` to Postgres.
   */
  if (typeof id !== "string" || id.length === 0) {
    return;
  }

  /**
   * A malformed UUID would raise 22P02 in Postgres. Since this value comes
   * from the client, we validate its shape before it reaches the DB.
   */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return;
  }

  await db.delete(notes).where(eq(notes.id, id));
  revalidatePath("/notes");
}

/**
 * Toggle pinned — a third pattern: bound arguments.
 *
 * `.bind(null, id)` on the client (or server) pre-fills the first argument,
 * which is how you pass "extra" data to an action beyond the FormData.
 * This is more explicit than a hidden input and can't be tampered with in the
 * same way (though you must STILL authorize it server-side — id is a claim,
 * not proof).
 */
export async function togglePinned(id: string): Promise<void> {
  const existing = await db
    .select({ pinned: notes.pinned })
    .from(notes)
    .where(eq(notes.id, id))
    .limit(1);

  const current = existing[0];
  if (!current) return;

  /**
   * Read-then-write is a race: two concurrent toggles can both read `false`
   * and both write `true`. Acceptable for a single-user demo; for real
   * multi-user data you'd use a single atomic statement, e.g.
   *   set pinned = not pinned
   * which Drizzle expresses with sql`not ${notes.pinned}`.
   */
  await db
    .update(notes)
    .set({ pinned: !current.pinned })
    .where(eq(notes.id, id));

  revalidatePath("/notes");
}
