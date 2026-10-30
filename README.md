# StickyNotes AI

A small full-stack project built to learn the Next.js (App Router) + TypeScript + PostgreSQL way of doing things, inside Docker.

## Stack

| Layer      | Tech                          | Notes                                          |
| ---------- | ----------------------------- | ---------------------------------------------- |
| Frontend   | Next.js 16.4.3, React 19.3    | App Router, Turbopack dev bundler              |
| Styling    | Tailwind CSS v4               | Loaded via `@tailwindcss/turbopack`            |
| Language   | TypeScript (strict)           | Types derived from runtime schemas via `zod`   |
| Database   | PostgreSQL 17 (Alpine)        | Named volume `postgres_data`                   |
| Runtime    | Node 24 (Alpine), `arm64`     | Native images on Apple Silicon — no Rosetta    |

## Quickstart

```bash
docker compose up -d          # starts db, waits for healthy, then starts web
docker compose ps             # confirm db is (healthy)
open http://localhost:3000
```

## Key commands

```bash
docker compose logs -f web          # follow the Next.js dev server
docker compose exec db psql -U sticky -d stickynotes   # psql shell
docker compose exec web node -e 'console.log(process.env.DATABASE_URL)'

docker compose down                 # stop, KEEP data
docker compose down -v              # stop, DELETE data (volumes)
docker compose build --no-cache     # full rebuild
```

## Adding a dependency (read this before you `npm install`)

`node_modules` inside the containers lives in a **named volume**, seeded from the
image **only on first attach**. The bind mount does not provide it — the volume
shadows it. So after `npm install <pkg>` on your host, the running containers
still have the old dependency set until you reseed:

```bash
./scripts/reseed-deps.sh            # rebuild image, drop only the dep volume
./scripts/reseed-deps.sh --wipe     # also drop postgres data (full dev reset)
```

Do not `npm install` inside the container as a workaround — that mutates the box
and drifts it away from the image, which is the whole thing Docker is meant to
prevent.

## Database (Drizzle ORM)

Schema-first, SQL-first: `src/db/schema.ts` is TypeScript that generates both
the migration SQL and the row types.

```bash
docker compose --profile tools run --rm migrator npm run db:generate   # write SQL migration
docker compose --profile tools run --rm migrator npm run db:migrate    # apply it
docker compose --profile tools run --rm migrator npm run db:smoke      # verify types end-to-end
docker compose --profile tools run --rm migrator npm run db:studio     # GUI
```

- Migrations land in `drizzle/` as readable SQL and **should be committed** —
  they're the audit trail of schema changes.
- `src/db/client.ts` exports two things, deliberately differently named:
  - `db` — the Drizzle client (type-safe query builder)
  - `pg` — the raw postgres.js client (real execution, transactions, `sql` tags)

  They are **not** interchangeable, and confusing them is a silent runtime bug:
  Drizzle's `sql` tag *builds* a fragment; postgres.js's `sql` tag *executes*
  and returns a Promise. Use `eq()` for `.where()` predicates.

### Gotchas this project hit (and their fixes)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `drizzle-kit: not found` in container | Stale `node_modules` volume | `./scripts/reseed-deps.sh` |
| `unrecognized configuration parameter "schema"` | `?schema=public` in `DATABASE_URL` is a **Prisma** convention; postgres.js forwards unknown params to Postgres | Remove the query string |
| `This module cannot be imported from a Client Component` from a script | `server-only` resolves to a throwing file outside Next's bundler | Run scripts with `NODE_OPTIONS=--conditions=react-server` |
| `Cannot find module '@/env'` under plain `node` | tsconfig `paths` is resolved by the bundler, not Node | Use `tsx`, or relative imports |
| `invalid input syntax ... "[object Promise]"` | postgres.js `sql` tag used where Drizzle expects a fragment | Use `eq()`; import the raw client as `pg` |

## One-off tooling (migrations, seeds)

The `migrator` service is behind a Compose **profile**, so it never auto-starts:

```bash
docker compose --profile tools run --rm migrator npm run <script>
```

⚠️ Always use `run --rm`, never `up -d`, for `migrator`. It's a **run-once**
container: `up -d` would leave it running forever doing nothing (and its
`npm run dev`-style command would just idle). `run --rm` starts it, runs the
command, and removes the container. You can see the distinction with
`docker compose --profile tools ps` — `migrator` should only ever appear there
*while a command is executing*.

## Networking model (the important mental shift)

- Inside the `web` container, `localhost` means **the web container itself**. It is NOT your Mac, and it is NOT the database.
- Containers reach each other by **service name**: `db:5432`, resolved by Docker's embedded DNS.
- Your Mac reaches Postgres via the **published port**: `localhost:5432`.

```
┌──────────── Your Mac ────────────┐        ┌────────── Docker network ──────────┐
│  browser → localhost:3000 ───────┼───────▶│  web  (Next.js, port 3000)         │
│  psql    → localhost:5432 ───────┼───┬───▶│  db   (Postgres, port 5432)        │
└──────────────────────────────────┘   │    │                                    │
                                       │    │  web → db:5432  ✓ (service DNS)   │
                                       └────┼──▶ web → localhost:5432 ✗ refused  │
                                            │    └────────────────────────────────┘
                                            └── published port mapping
```

## Dockerfile stages

| Stage      | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `base`     | Shared foundation: Node 24 Alpine, workdir, env     |
| `deps`     | `npm ci` — cached unless the lockfile changes        |
| `dev`      | What Compose runs; code arrives via bind mount       |
| `builder`  | Production compile → `.next/standalone`              |
| `runner`   | Slim runtime, non-root user, `node server.js`        |

`output: "standalone"` in `next.config.ts` is what makes `runner` possible: Next traces the exact files the server needs and emits a minimal `node_modules`, so the shipped image doesn't carry devDependencies or source code.

## Environment variables

- **`.env`** (gitignored) — Postgres credentials. Compose reads it to interpolate `compose.yaml`.
- **`src/env.ts`** — the typed contract. Every server env var is validated with `zod` at boot; the TypeScript type is derived from the same schema with `z.infer`, so they can't drift apart.
- **`DATABASE_URL`** is *derived* in `compose.yaml` from the same three variables Postgres uses, so the app and the database can't disagree.

## Performance note (macOS + Docker)

Code is bind-mounted from macOS into a Linux container, which crosses Docker Desktop's file-sharing layer. As of Next.js 16 the dev server hot-reloads fine this way (~50ms) **without** polling. If you ever see stale rebuilds, prefer Docker Desktop's *synchronized file shares* over enabling polling — polling adds latency and high CPU/I/O. Reserve Docker for realistic testing; running `npm run dev` directly on the host is still faster for pure app work.
