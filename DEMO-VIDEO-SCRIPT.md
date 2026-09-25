# Demo video script — one full event lifecycle in 5 minutes

Target: `http://localhost:3000` after `docker compose up --build`.
Demo logins (password `openjudge`): `organizer@example.org`,
`judge@example.org`, `participant@example.org`. Total budget: 5:00.

## 0:00–0:30 — Cold open: one command

Terminal: `docker compose up --build`. Voiceover: "No cloud account, no API
keys — Postgres and the app, seeded." Cut to `http://localhost:3000` showing
OpenHack 2026, 12 projects, prizes. State the thesis in one line: "Other
tools give you a leaderboard. Ours tells you whether to trust it."

## 0:30–1:30 — Submit (participant)

Sign in as `participant@example.org` → Submit. Fill the form (use the
thumbnail + tags), save a draft, then Submit for judging. Show the project
appearing in the public gallery. Mention: deadline enforced server-side,
custom questions answered inline.

## 1:30–2:30 — Judge (the differentiator)

Sign in as `judge@example.org` → Judging console. Open the MigrateMate draft:
point at the evidence strip (claims supported/contradicted, replay status).
Score all five criteria, save draft, submit. Then the head-to-head duel: pick
a winner twice. Say: "Humans enter every number. Machines only gather evidence."

## 2:30–3:30 — Organize

Sign in as `organizer@example.org` → dashboard. Assignment round, leaderboard
with raw vs normalized side by side, Export CSV. Decision confidence: read the
FRAGILE explanation aloud. Freeze the rubric, scroll the audit trail. Open the
LogLens receipt (`/organisms/...`) — anonymized judges, four methods, verdict.

## 3:30–4:15 — Community + API

`/vote`: cast a vote, show results hidden, publish as organizer, tally
appears. Comment on a project. Then `curl /api/openapi.json` in the terminal
and `GET /api/submissions` — "every UI action is an API call."

## 4:15–5:00 — Close on honesty

Show `.dogfood.toml` tiers (T1–T4 claimed, one gap: signed judge
participation records) and `acceptance-report.txt` PASS. End card: repo URL,
MIT license, "fork it and run your event on Monday."

## Recording notes

- 1080p, browser zoom 125%, dark UI as-is.
- Keep the terminal font large; pause 2s on each toast.
- If anything is slow, cut the pause, never the step — the suite passing
  (`npm run test:acceptance`) can flash by at 4:45 as the receipt.
