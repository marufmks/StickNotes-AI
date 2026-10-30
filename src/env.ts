import "server-only";
import { z } from "zod";

/**
 * The server-side environment contract.
 *
 * PHRASING NOTE FOR A PHP BRAIN:
 * In PHP you'd write `getenv('DATABASE_URL')` dozens of times and hope each
 * call site handled `false` correctly. Here we define the shape of ALL
 * server config in ONE place, derive the TypeScript type FROM the runtime
 * validator, and fail loudly at boot if reality doesn't match the contract.
 *
 * Structure decisions:
 *
 * 1. ONE SCHEMA → TWO ARTEFACTS. We don't write an `interface` and a separate
 *    validator. `z.infer` extracts the type from the schema, so the runtime
 *    check and the compile-time type literally cannot drift apart.
 *
 * 2. `server-only` is a build-time firewall. If a Client Component (browser)
 *    ever imports this module, the BUILD FAILS. That is the Next.js
 *    equivalent of "never echo a DB password into HTML" — enforced by the
 *    compiler rather than by code review.
 *
 * 3. EVERYTHING IN process.env IS `string | undefined`. Ports must be
 *    coerced, booleans must be parsed. This is the #1 footgun when coming
 *    from typed backend languages.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z
    .string()
    .refine((v) => v.startsWith("postgresql://"), {
      message: "DATABASE_URL must start with postgresql://",
    }),

  // Example of the coercion trap, documented so you don't trip on it later:
  //   z.coerce.number() on `""` yields 0 (falsy but VALID), not an error.
  // For optional numerics prefer an explicit string→number transform.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

/**
 * z.infer reads the schema and produces a plain TS type:
 *
 *   { NODE_ENV: "development" | "test" | "production";
 *     DATABASE_URL: string;
 *     AI_REQUEST_TIMEOUT_MS: number }
 *
 * Change the schema → the type changes → the compiler re-checks every
 * call site. That's the whole point.
 */
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validate once, at module load (i.e. at server boot), not at each use site.
 *
 * Modules are evaluated once per server process, so this effectively becomes
 * a boot-time assertion: the container either starts healthy or dies loudly
 * on `docker compose up`. That's far better than an obscure ECONNREFUSED
 * deep inside a request handler at 2am.
 */
function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // z.treeifyError gives a readable, field-by-field report.
    console.error("Invalid server environment variables:");
    console.error(JSON.stringify(z.treeifyError(parsed.error), null, 2));
    throw new Error("Invalid server environment variables");
  }

  return parsed.data;
}

export const env: ServerEnv = loadServerEnv();
