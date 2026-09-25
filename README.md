# OpenJudge

Open-source, self-hostable hackathon submission and judging platform.

Other judging tools give you a leaderboard. OpenJudge tells you whether to trust
it — and gives every team the receipt. See [RESEARCH.md](RESEARCH.md) for why
that is the gap worth filling.

## Features

- **Decision-robustness certificate** — every prize boundary is recomputed under
  four defensible rules (raw average, judge-calibrated average, pairwise
  Bradley-Terry, rank-based Borda). A place is `ROBUST` only when all four agree;
  otherwise it is `FRAGILE` and the dashboard names the rules that disagree and
  the projects still in contention.
- **Prize-boundary-targeted reviews** — the next available review is aimed at the
  project most likely to settle a contested prize cutoff, without breaking
  conflicts, self-review or workload balance.
- **Contestable audit receipt** — each team sees every score it received with
  anonymised judges, each judge's measured harshness, its placing under all four
  rules and its confidence interval, so a dispute names a specific input.
- **Replay harness** — simulate an event before running it: judge count, reviews
  per project, harshness spread, aggregation rule.
- **Public event page and project gallery** — event info, timeline, tracks, and
  every submitted project with repo, demo and video links.
- **Submissions** — participants create and edit their own project while
  submissions are open.
- **Balanced round-robin assignment** — every project gets the same number of
  independent reviews, judge workloads stay within one review of each other, no
  one reviews their own team, conflicts of interest are excluded, and re-running
  a round only fills gaps.
- **Normalized results** — per-judge z-scores mapped back to the score scale,
  weighted criteria, a minimum-review guard, and raw versus normalized ranks side
  by side.
- **Judging console** — each judge sees only their assignments, with drafts and
  final submission, plus head-to-head pairwise voting.
- **Organizer dashboard** — settings, judges, conflicts, assignment rounds,
  decision confidence, results, CSV export at every stage, rubric freeze,
  audit trail, role grants, voting controls, webhooks.
- **Community voting** — one-person-one-vote or quadratic, hidden results until
  published, randomized ballots, rate limits, comments with moderation.
- **REST API + OpenAPI** — every core action at `/api/*`, spec at
  `/api/openapi.json`; HMAC webhooks; embeddable gallery at `/embed/gallery`.
- **Self-hostable** — one `docker compose up`, plain SQL migrations, demo seed.

## Quick start (self-host)

```sh
cp .env.example .env      # set POSTGRES_PASSWORD at minimum
docker compose up --build
```

Then open <http://localhost:3000>. Postgres starts alongside the app, the
migrations in `db/migrations/` are applied on first boot, and the demo event is
loaded unless you set `OPENJUDGE_SEED_DEMO=false`. No cloud account, no hosted
database, no Auth-as-a-Service — with images built, everything works offline.

Sign up for a local account (email + password, scrypt-hashed, session cookie —
no hosted identity, everything works offline). The first account to sign up can
claim the organizer role from the organizer dashboard. After that, the claim is
closed and organizers grant roles.

For hands-on demos without clicking through signup, the seed ships three
working logins (password `openjudge`, local fixture only):

- `organizer@example.org` — full dashboard, leaderboard, freeze, audit
- `judge@example.org` — linked to Ada Reyes, with a draft review to finish
- `participant@example.org` — plain participant

Prefer your own password? Create ad-hoc accounts instead:

```sh
OJ_DEMO_PASSWORD='a-strong-password' npx tsx mesh/seed-accounts.ts
# organizer@ / judge@ / participant@@openjudge.local (judge linked to Ada Reyes)
```

## Local development

```sh
npm install
docker compose up -d db   # local Postgres on :5432
DATABASE_URL=postgres://openjudge:change-me@localhost:5432/openjudge npm run dev  # http://localhost:8080
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | database credentials |
| `DATABASE_URL` | connection string used by the app (`@db:5432` in compose) |
| `OPENJUDGE_SEED_DEMO` | `false` to start with an empty database |
| `APP_PORT` | host port for the web app (default 3000) |

## Judging defaults

Five criteria — Impact, Innovation, Technical Execution, Design, Presentation —
each scored 1–10 against the event's configured weights (the seed uses equal
weights), all editable by organizers until the rubric is frozen. Three reviews per
project. The scoring window opens and closes on organizer action. The
evidence pipeline additionally scores the fixed 25/20/30/15/10 rubric for its
robustness certificate (see `src/lib/engine/scoring.ts`).

## Evidence-first pipeline (Mesh + Observatory)

- **Mesh Agent** (`mesh/agent.mjs`, zero dependencies) — analyzes a local project and seals a signed
  evidence manifest. Hashes and structure only; secrets, env files, and file contents never leave the machine.
  ```sh
  node mesh/agent.mjs analyze ./your-project --event <event> --project <id> --team <name> --submission <uuid>
  node mesh/agent.mjs replay manifest.json        # run declared acceptance scenarios, sign the report
  node mesh/agent.mjs verify manifest.json --key agent.key
  # attach participant files (interaction trace, demo scene, scans) by hash:
  # --attach interaction_trace:demo/journey.trace.json:core_flow_runs
  # --attach spatial_demo_scene:demo/scene.json:impact_statement
  ```
- **The Observatory** (`/observatory`, plus the public receipt at `/organisms/:submissionId`) — the decision
  laboratory: evidence orbit (AST constellation + accessible tables, anomalies, replay reports), rubric orbit
  (five fixed-weight criteria, 25/20/30/15/10, human-entered 1–10 with rationale and evidence links), decision
  orbit (evidence sufficiency, stress scenarios, robustness certificate, seal + receipt).
- Engines in `src/lib/engine/`: `scoring.ts` (fixed weights, normalization), `evidence.ts` (ESI, targets,
  claim status, anomalies, stress), `manifest.ts` (schema, Merkle seal, ed25519), `certificate.ts`
  (ROBUST/FRAGILE evidence certificate over the same four ranking rules).
- Mesh tables live in self-host Postgres (`db/migrations/002_mesh.sql`); demo fixture in `db/seed_mesh.sql`.

## Tests

```sh
npx vitest run                              # engines + validation (93 tests)
E2E_BASE_URL=http://localhost:3000 npx playwright test   # browser flows (21 tests)
npm run test:acceptance                     # typecheck + unit + e2e -> acceptance-report.txt
```

## Documentation

- [RESEARCH.md](RESEARCH.md) — the research gap in hackathon judging and what is novel here
- [ARCHITECTURE.md](ARCHITECTURE.md) — stack, layout, request flow, security model
- [DATA-MODEL.md](DATA-MODEL.md) — every table, relationship and access rule
- [JUDGING.md](JUDGING.md) — assignment algorithm and normalization math with a worked example
- [THREAT-MODEL.md](THREAT-MODEL.md) — what abuse is stopped, and the honest list of what is not
- [db/README.md](db/README.md) — migrate, seed and reset

## License

MIT.
