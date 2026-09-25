# Threat model — OpenJudge

Written for the DOGFOOD Threat Model bonus and for Judging Integrity (25%).
Policy: name the attacks we stopped **and the ones we did not**. The honest
list is worth more than the heroic one.

## Scope

A self-hosted hackathon portal: participants submit, judges score, organizers
operate, visitors browse. Attackers may be participants gaming results,
curious judges, or internet background noise. The asset is **decision
integrity**: the right projects win for checkable reasons.

## Stopped

| Attack | Mitigation (where in code) |
|---|---|
| Judge reads another judge's scores via UI **or API** | Backend scoping, not hidden buttons. `myQueue` returns only the caller's assignments (`src/lib/judge.functions.ts`); `saveReview` re-checks ownership before every write; `leaderboard`/`decisionCertificate` assert organizer (`src/lib/organizer.functions.ts:assertOrganizer`); the private receipt allows owner-or-organizer only (`src/lib/participant.functions.ts:projectReceipt`). Verified by auth-gate e2e (`tests/e2e/site.spec.ts`). |
| Self-review / conflict judging | `planAssignments` excludes owned and conflicted pairs (`src/lib/engine/assignment.ts`); covered by `assignment.test.ts`. |
| Deadline gaming (late submit via clock skew or replayed request) | Server-authoritative window in `saveProject` (`src/lib/participant.functions.ts`): submit requires `submissions_open` and a future `ends_at`, checked against server time, plus `submissionWindowStatus` unit tests. |
| Score tampering after the fact | Every sensitive mutation appends to `audit_events` (`src/lib/mesh/audit.ts`, best-effort so logging can never break judging): settings, judges, conflicts, assignment rounds, submissions, reviews, assessments, eligibility, rubric freeze. Organizers read it in the Governance panel without a database client. |
| Evidence forgery (fake replay/claim support) | ed25519-signed manifests with Merkle roots (`src/lib/engine/manifest.ts`); replay reports verified against the manifest's stored key before any claim flips to SUPPORTED (`src/lib/mesh/mesh.functions.ts:submitReplayRun`). |
| Secret exfiltration via the Mesh Agent | The agent never uploads contents; `SECRET_PATTERNS` refuse to seal (`mesh/agent.mjs`); attached files are hash-only with `trusted:false` provenance. |
| Weak/known passwords | Local scrypt hashes; signup rejects short passwords. No breach-corpus check — acceptable for self-hosted use. |
| Privilege escalation to organizer | `claimFirstOrganizer` grants only when zero organizers exist; everything else requires the role server-side. |

## Not stopped (honest list)

| Attack | Status |
|---|---|
| Community-vote Sybil / ballot stuffing | **Not applicable yet — no voting exists.** If T3 voting ships: email-gated or quadratic voting, per-voter rate limits, uniqueness on `(event, submission, voter)`, hidden results until publish. None of this is built. |
| Submission scraping | No rate limiting yet. Gallery payloads carry no scores or emails, which bounds the damage. |
| Judge collusion (two judges trading high scores) | Not detected automatically. Partially visible: calibration exposes correlated harshness/leniency, and the FRAGILE certificate flags boundaries where reviewer agreement is low. No dedicated collusion detector. |
| Organizer acting maliciously | Out of scope by design — organizers can see everything (isolation matrix). The audit trail records what they did; it cannot stop them. |
| Hosted-dependency outage | Eliminated: auth, reads, and writes all run against the composed Postgres. No cloud account, database, or identity service is contacted at runtime. |
| Timing side-channels on score endpoints | Not considered; scores are low-sensitivity aggregates, not secrets. |

## What a judge should curl

1. As judge A, `myQueue` must never contain judge B's assignments.
2. `saveReview` with another judge's `assignmentId` must fail ownership.
3. `leaderboard` without the organizer role must fail.
4. `getSubmission` for a `draft` id must 404 (only `submitted` is public).

Items 1–3 are covered by auth-gate e2e; item 4 by the gallery tests.
