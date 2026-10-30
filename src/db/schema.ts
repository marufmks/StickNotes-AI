import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * THE SINGLE MOST IMPORTANT DRIZZLE IDEA:
 *
 * Your schema is not a separate `.prisma`-style file that a generator reads.
 * It IS TypeScript. The table declaration produces, at compile time:
 *
 *   - the SQL the migration runner executes
 *   - a SELECT row type (InferSelectModel)
 *   - an INSERT row type (InferInsertModel)
 *
 * Three artefacts, one declaration. This is the same "one source of truth"
 * move we made with zod in src/env.ts — just applied to the database.
 */

/**
 * A Postgres ENUM is a real, constrained server-side type — not a free-text
 * column with a comment asking people nicely.
 *
 * Why define it in TS and generate SQL from it: if you add "gray" later, the
 * change is a diff here, and `drizzle-kit generate` produces the ALTER TYPE.
 * A hand-written SQL migration + a hand-written TS union would drift.
 */
export const noteColorEnum = pgEnum("note_color", [
  "yellow",
  "pink",
  "blue",
  "green",
  "purple",
]);

export const notes = pgTable("notes", {
  /**
   * uuid + gen_random_uuid().
   *
   * Two decisions worth understanding:
   *
   * 1. `uuid` over `serial`/autoincrement int. PHP/Laravel's default habit is
   *    incrementing integers, which leak row counts to the public
   *    (/note/1234 exists → /note/1235 probably does). Random UUIDs are
   *    unguessable, so they're safe to put in a URL, and they're mergeable
   *    across environments.
   *
   * 2. `default gen_random_uuid()` runs IN Postgres, so the database assigns
   *    the id. The application never has to "generate then insert", which
   *    means no race between two processes generating the same id.
   *    (PostgreSQL 13+ ships gen_random_uuid() built-in — no pgcrypto needed.)
   */
  id: uuid("id").defaultRandom().primaryKey(),

  /**
   * TEXT vs VARCHAR.
   *
   * In MySQL-world you pick VARCHAR(255) out of habit. In Postgres, `text`
   * has NO practical length limit and is the same speed as varchar for the
   * common case. Use `text` unless you have a measured reason not to.
   *
   * `.notNull()` here is what makes the INSERT type require these fields.
   * Omit it and `title?: string | null` appears — an optional you must
   * handle at every use site forever.
   */
  title: text("title").notNull(),
  content: text("content").notNull().default(""),

  /**
   * `noteColorEnum` is a generated column type helper: Drizzle infers
   * the TS union "yellow" | "pink" | ... from the pgEnum above.
   * You cannot insert "orange" — the compiler stops you, and so does the DB.
   */
  color: noteColorEnum("color").notNull().default("yellow"),

  pinned: boolean("pinned").notNull().default(false),

  /**
   * `.defaultNow()` → SQL DEFAULT now(). Again the DB assigns the value,
   * so it's consistent across app instances and timezones.
   */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /**
   * `$onUpdateFn` is Drizzle's UPDATE-side hook: it sets the column on every
   * update from the ORM. Note the honest caveat — it does NOT apply to raw
   * SQL (`update ... set ...` written by hand bypasses it). That's why
   * production schemas often use a DB trigger instead. Know the tradeoff
   * rather than assuming the magic covers you.
   */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

/**
 * THE TYPE DERIVATION — the payoff.
 *
 * InferSelectModel<Table> → what Postgres returns when you SELECT a row.
 * InferInsertModel<Table> → what you must supply when you INSERT.
 *
 * The asymmetry is deliberate and is the part to notice: on INSERT, `id`,
 * `createdAt`, `updatedAt` are OPTIONAL (the DB fills them), while `title`
 * is REQUIRED (it's .notNull() with no default). On SELECT, everything is
 * present and non-null.
 *
 * In PHP you'd get this from a docblock that nobody enforces.
 */
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

/**
 * A narrower DTO for things like API responses, where you don't want to leak
 * internal columns by accident. Hand-declared here so the compiler tells you
 * if the schema later adds a field you forgot to consider.
 */
export type NoteColor = (typeof noteColorEnum.enumValues)[number];
