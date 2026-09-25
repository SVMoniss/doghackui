# Architecture

## Stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start v1 (React 19, Vite 7) |
| Routing | TanStack Router file routes in `src/routes` |
| Server logic | `createServerFn` RPC in `src/lib/*.functions.ts` + `POST /api/auth/*` for sessions |
| Data | Self-host PostgreSQL 16, plain SQL via `pg` — no hosted database |
| Auth | Local email + password (scrypt), opaque session cookies, roles in `user_roles` |
| UI | Tailwind CSS v4 tokens + shadcn/ui primitives |
| Tests | Vitest for the engines, Playwright for acceptance flows |

There are no cloud accounts, no Auth-as-a-Service, no external APIs. With
images built, `docker compose up` runs fully offline.

## Layout

```text
src/
  routes/                    pages; _authenticated/* is behind a session gate
    index.tsx                event home
    projects.tsx             project gallery
    projects.$id.tsx         project detail
    auth.tsx                 sign in / sign up (local accounts)
    organisms.$submissionId  public evidence receipt
    _authenticated/submit    create and edit your own project
    _authenticated/judge     judging console
    _authenticated/admin     organizer dashboard
    _authenticated/observatory  decision laboratory
    _authenticated/team/$token  invite acceptance
  lib/
    auth/                    scrypt passwords, sessions, cookie gate, API client
    engine/assignment.ts     balanced round-robin planner (pure)
    engine/normalize.ts      score normalization (pure)
    engine/scoring.ts        fixed-weight Q score (pure)
    engine/certificate.ts    ROBUST/FRAGILE evidence certificate (pure)
    mesh/                    manifest ingest, evidence, replay, teams (all PG)
    hackathon.functions.ts   public reads (event, project list, project detail)
    participant.functions.ts my projects, save, delete, roles, first-organizer claim
    judge.functions.ts       judge queue, save or submit a review
    organizer.functions.ts   settings, judges, conflicts, assignment, results
  server.ts                  health endpoints, local auth API, SSR wrapper
db/
  migrations/00*.sql        full schema in filename order (sessions in 008)
  seed.sql                   demo event (12 projects, 5 judges, scores)
  seed_mesh.sql              demo organism, assessments, eligibility
  seed_prizes.sql            demo prizes
tests/e2e/                   Playwright acceptance tests
```

## Request flow

1. A page component calls a server function through `useServerFn`, wrapped in
   TanStack Query. Auth pages call `POST /api/auth/*` with plain fetch.
2. Authenticated server functions run `requireAuth`, which reads the
   `oj_session` cookie, resolves it against the `sessions` table, and hands
   the handler a `userId`.
3. Every input is validated with Zod before it touches the database.
4. Every ownership check is a SQL predicate (`owner_id = $userId`, judge-join
   on `user_id`, `user_roles` lookup) — enforced in the backend on every
   read and write, never just hidden in the UI.
5. Cross-origin browser POSTs to `/api/auth/*` are rejected by Origin/Referer
   check on top of `SameSite=Lax` cookies.

## Security model

- Passwords are scrypt-hashed; sessions are opaque 256-bit tokens stored as
  sha256, httpOnly, 30-day expiry.
- Roles live in `user_roles`, never on a profile row. Organizer-only server
  functions check the role in SQL before doing anything.
- A judge can only read and write assignments that belong to them, enforced by
  join predicates in `myQueue`/`saveReview` plus track-scope filtering.
- Project owners can edit only their own project while submissions are open
  (server-side window check in `saveProject`).
- Sensitive mutations append to append-only `audit_events` (best-effort, never
  blocking); organizers read them in the Governance panel.
- Evidence writes are signature-checked (ed25519 manifests, replay reports)
  before any claim status changes.

## One deployment shape

`docker compose up` starts Postgres plus the built Node server. Migrations run
on first boot, demo data seeds automatically, and everything — auth, reads,
writes, judging — works with the network off.
