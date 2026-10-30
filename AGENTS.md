<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# StickyNotes AI

Next.js 16.4.3 (App Router, Turbopack) + TypeScript + PostgreSQL via Drizzle.
**All container work runs inside Docker Compose on Apple Silicon (arm64).**

## Verify before you finish

```bash
docker compose exec -T web npx tsc --noEmit    # typecheck (NO `typecheck` script exists)
docker compose exec -T web npx eslint          # lint  (= `npm run lint`)
docker compose --profile tools ps              # should list only db + web at rest
```

Run these inside the container, not on the host. Host `node_modules` is
darwin-arm64; the containers are linux-arm64.

## Adding a dependency — the #1 trap in this repo

`node_modules` lives in a **named Docker volume**, seeded from the image **once,
on first attach**. The bind mount (`.:/app`) does *not* provide it — the volume
shadows it. So after `npm install <pkg>` on the host, running containers still
have the old dep set until you reseed:

```bash
./scripts/reseed-deps.sh          # rebuild image, drop ONLY the dep volume, keep postgres data
./scripts/reseed-deps.sh --wipe   # also drop postgres data (full dev reset)
```

Symptom if you forget: `drizzle-kit: not found`, `Cannot find module 'zod'`,
or a native module built for darwin crashing in linux. Do **not** `npm install`
inside the container as a workaround — that mutates the box and drifts it from
the image.

## Commands that must go through Compose

```bash
docker compose up -d                                   # db (waits for healthy) then web
docker compose logs -f web
docker compose exec db psql -U sticky -d stickynotes
docker compose --profile tools run --rm migrator npm run db:generate   # writes drizzle/*.sql
docker compose --profile tools run --rm migrator npm run db:migrate    # applies them
docker compose --profile tools run --rm migrator npm run db:smoke      # typed insert/select round-trip
docker compose --profile tools run --rm migrator npm run db:studio
```

- Always `run --rm` for `migrator`, never `up -d`. It is run-once; `up -d`
  leaves it idle-running forever.
- `DATABASE_URL` is **derived** in `compose.yaml` from the same `POSTGRES_*`
  vars Postgres uses. Don't hardcode a second copy.
- Migrations in `drizzle/` are readable SQL and **should be committed**.
- `output: "standalone"` in `next.config.ts` is load-bearing: the Dockerfile
  `runner` stage needs `.next/standalone/server.js`. Removing it breaks prod.

## Gotchas already hit (do not rediscover these)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `unrecognized configuration parameter "schema"` | `?schema=public` in `DATABASE_URL` is a **Prisma** convention. Drizzle's driver (postgres.js) forwards unknown URL params to Postgres as runtime config, which rejects them. | No query string on the URL. |
| `This module cannot be imported from a Client Component module` when running a script | `server-only` resolves via conditional exports: `react-server` → empty file, `default` → throws. Next sets the condition; plain `node`/`tsx` do not. | Prefix the script with `NODE_OPTIONS="--conditions=react-server"` (already in `npm run db:smoke`). |
| `Cannot find module '@/env'` under plain `node` | tsconfig `paths` is resolved by the bundler, not Node. | Use `tsx` (reads tsconfig), or relative imports in standalone scripts. |
| `invalid input syntax ... "[object Promise]"` | postgres.js and `drizzle-orm` both export a tag named `sql`, doing opposite jobs: Drizzle's *builds* a fragment, postgres's *executes* and returns a Promise. Using the postgres tag in `.where()` typechecks, then binds the Promise as a parameter. | Import the raw client as `pg` (see `src/db/client.ts`); use `eq()` from `drizzle-orm` for predicates. |
| Silent no-op from `drizzle-kit` (spinner swallows the error) | Interactive TTY spinner overwrites the message. | Redirect to a file and inspect the real exit code: `node node_modules/drizzle-kit/bin.cjs migrate >out.log 2>err.log; echo $?` |

## Conventions worth knowing

- `src/env.ts` is the typed config contract (zod + `z.infer`), guarded by
  `server-only`. Validate env there; don't sprinkle `process.env` reads.
- `src/db/client.ts` caches the pool on `globalThis` — required in `next dev`,
  where hot reload re-evaluates modules and would otherwise exhaust
  `max_connections`. Don't "simplify" it to a module-level constant.
- Schema types come from the schema, not hand-written: `Note` =
  `InferSelectModel`, `NewNote` = `InferInsertModel`. Which fields are optional
  on insert is derived from SQL `DEFAULT`s — don't restate it in an interface.
- `.notNull()` without a `default()` ⇒ required on insert. Adding a `default()`
  silently makes it optional in `NewNote`; check call sites.
- Tailwind v4 via `@tailwindcss/turbopack` in `next.config.ts`, not a
  `tailwind.config.js`.
- `db-smoke.ts` at the repo root is a throwaway verification script, not
  application code. Leave it out of `src/`.
