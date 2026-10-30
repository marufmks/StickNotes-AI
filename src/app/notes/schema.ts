import { z } from "zod";
import { noteColorEnum } from "@/db/schema";

/**
 * FORM VALIDATION CONTRACT.
 *
 * PHP analogy: this is a FormRequest class. The schema declares the rules,
 * and `NoteActionState` is the shape you'd return from `validate()` or
 * `$request->failed()` — except both come from one declaration.
 *
 * WHERE THIS RUNS: `z` runs in BOTH places. The Server Action uses it to
 * reject bad input on the server (the only place that matters). The Client
 * Component imports the *type* to render field errors. Only the type crosses
 * the boundary — the validation code ships zero bytes to the browser.
 */

/**
 * `noteColorEnum.enumValues` is `readonly ["yellow","pink",...]` — generated
 * from the pgEnum in src/db/schema.ts. So the form's allowed colors, the DB's
 * allowed colors, and the TS union are ONE declaration. Add "gray" in one
 * place and every layer follows. This is the same single-source-of-truth move
 * as `z.infer` in src/env.ts.
 */
const colors = noteColorEnum.enumValues;

export const noteInputSchema = z.object({
  /**
   * `.trim()` then `.min(1)`: order matters.
   * Without trim, `"   "` passes `.min(1)` — a whitespace-only title that
   * looks empty in the UI. In PHP you'd hit this with `$request->filled()`.
   */
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(1, "Title cannot be empty")
    .max(120, "Title is too long (max 120 characters)"),

  /**
   * `.default("")` — an omitted content field is VALID and means "empty note".
   *
   * Without this, `content` is required and the error you get is
   * "expected string, received undefined", which is meaningless to a user.
   * This matches the DB column, which is `text NOT NULL DEFAULT ''`.
   *
   * Rule of thumb: if the database column has a DEFAULT, the input schema
   * should have a matching `.default()`. Otherwise the two layers disagree
   * about what "absent" means and you get errors that look unrelated to
   * the field the user actually left blank.
   */
  content: z
    .string({ error: "Note must be text" })
    .trim()
    .max(10_000, "Note is too long")
    .default(""),

  /**
   * z.enum() with the tuple from the pgEnum. Inserting an invalid color is
   * now impossible at three layers: the TS union, this runtime schema, and
   * the Postgres ENUM we verified rejects it with 22P02.
   */
  color: z.enum(colors).default("yellow"),

  /**
   * HTML checkboxes: an UNCHECKED box sends nothing at all — not "false".
   * So we must coerce absent → false. In PHP this is `request->boolean()`.
   * Getting this wrong silently marks every note pinned.
   */
  pinned: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.null()])
    .transform((v) => v === "on" || v === "true")
    .default(false),
});

/** What the client is allowed to send. Derived, never hand-written. */
export type NoteInput = z.infer<typeof noteInputSchema>;

/**
 * THE ACTION STATE CONTRACT.
 *
 * `useActionState` needs a stable initial value and a reducer-like signature.
 * This type is that state machine, and it's deliberately explicit rather than
 * `any` — because a form's three real states are where React apps get sloppy.
 */
export type NoteActionState =
  | { status: "idle"; fieldErrors: null; message: null }
  | {
      status: "invalid";
      /** Field name → error messages. Keyed so the form can attach them inline. */
      fieldErrors: Partial<Record<keyof NoteInput, string[]>>;
      message: null;
    }
  | {
      status: "error";
      fieldErrors: null;
      /** Unexpected failure (DB down, etc.) — distinct from user error. */
      message: string;
    }
  | {
      status: "success";
      fieldErrors: null;
      message: string;
    };

/**
 * The initial state passed to useActionState.
 *
 * WHY a constant: React compares state identity to decide whether to
 * re-render. A fresh object literal on every render would defeat that. Export
 * it so the form and any tests share one source.
 */
export const initialNoteState: NoteActionState = {
  status: "idle",
  fieldErrors: null,
  message: null,
};
