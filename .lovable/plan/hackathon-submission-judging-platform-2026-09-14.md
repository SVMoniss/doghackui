# Hackathon Submission & Judging Platform

A self-hostable platform where teams submit projects, organizers assign judges automatically, and scores are normalized before ranking.

## What gets built

### 1. Core app (runs in this project's preview immediately)
- **Home / event page** at `/` — event info, timeline, call to action.
- **Submissions**: create and edit a submission (team name, title, tagline, description, repo URL, demo URL, video URL, track, tags), list view, detail view.
- **Judge console** at `/judge` — only the submissions assigned to the signed-in judge, one scoring form per assignment, save-as-draft and submit.
- **Organizer dashboard** at `/admin` — manage event, criteria, judges, tracks; run judge assignment; view raw vs normalized leaderboard; export CSV.
- **Auth**: email sign-in with roles (organizer, judge, participant) stored in a separate roles table.

### 2. Judge assignment (balanced round-robin)
Each submission gets the same number of independent reviews (default 3), each judge gets a near-equal workload (max difference of 1), no judge reviews their own team, and conflicts of interest are excluded. Deterministic and re-runnable: re-running only adds what is missing rather than shuffling existing work.

### 3. Normalization engine
Raw scores are adjusted for judge harshness/leniency before ranking:
- z-score per judge across their own scores, mapped back to the score scale,
- weighted criteria totals,
- min-review-count guard (submissions below the review threshold are flagged, not silently ranked),
- both raw and normalized ranks shown side by side so organizers can see the effect.

### 4. Self-hosting artifacts
- `Dockerfile` (multi-stage: install, build, run Node server) and `docker-compose.yml` (app + PostgreSQL + volume + env file).
- `.env.example`, SQL migrations under `db/migrations/`, and a seed script that creates a demo event, criteria, 12 submissions, 5 judges, and assignments.
- `db/README.md` for migrate/seed commands.

### 5. Tests
End-to-end acceptance tests covering: submit a project, assignment produces balanced coverage, judge scores an assigned submission, judge cannot open an unassigned one, leaderboard reflects normalization, CSV export.

### 6. Documentation
`README.md` (what it is, quick start, self-host with docker-compose, configuration), `ARCHITECTURE.md`, `DATA-MODEL.md` (tables, relations, access rules), `JUDGING.md` (assignment algorithm, normalization math, worked example).

## Defaults chosen (say the word to change any)
- Criteria: Impact, Innovation, Technical Execution, Design, Presentation — each 1-10, equal weight, editable by organizers.
- 3 reviews per submission; scoring window opens/closes on organizer action.
- Tracks optional; assignment respects track when set.

## Technical notes
- App: TanStack Start (React 19) with server functions for all writes; Postgres via Lovable Cloud for the hosted preview, so the app is live and usable here without Docker.
- The Docker/compose/migration path is the self-host story: the same schema expressed as plain SQL migrations against a standalone Postgres, with connection details from env vars. The hosted preview and the self-host path share the schema and the normalization/assignment code.
- Assignment and normalization live in pure modules with unit-testable functions, called from server functions and from the seed script.
- Row-level security on every table; roles in a dedicated `user_roles` table with a security-definer role check.
- Tests: Vitest for the pure engines, Playwright for the e2e acceptance flows.
