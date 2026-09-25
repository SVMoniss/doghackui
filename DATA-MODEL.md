# Data model

All tables live in the `public` schema of the self-host PostgreSQL — the only
database. Timestamps are `timestamptz`; `updated_at` is maintained by a trigger.

## users / sessions / profiles

| Column | Notes |
| --- | --- |
| `users.id` | primary key |
| `users.email` | unique, lowercased at signup |
| `users.password_hash` | `scrypt$N$r$p$salt$hash`, verified with `timingSafeEqual` |
| `users.display_name` | from the email local part at signup |
| `sessions` | `user_id` → users (cascade), `token_hash` (sha256, unique), `expires_at` (30 days) |
| `profiles` | `id` → users, display mirror |

Auth is local: `POST /api/auth/signup|signin|signout`, `GET /api/auth/me`,
`oj_session` httpOnly cookie (`SameSite=Lax`, same-origin POST check).
No Auth-as-a-Service anywhere.

## user_roles

| Column | Notes |
| --- | --- |
| `user_id` | → users, cascade delete |
| `role` | enum `organizer` \| `judge` \| `participant` |
| unique | `(user_id, role)` |

Roles are deliberately a separate table. `has_role(user_id, role)` is a
security-definer function used by every policy and by organizer-only server
functions. New accounts get `participant` automatically.

## events

`slug` (unique), `name`, `tagline`, `description`, `starts_at`, `ends_at`,
`submissions_open`, `judging_open`, `reviews_per_submission` (default 3).

Public read. Organizers manage.

## tracks

`event_id`, `slug`, `name`; unique `(event_id, slug)`. Optional — assignment
respects a track when one is set. Public read, organizers manage.

## criteria

`event_id`, `name`, `description`, `weight` (default 1), `min_score` (1),
`max_score` (10), `position`. Public read, organizers manage. Defaults: Impact,
Innovation, Technical Execution, Design, Presentation.

## submissions

`event_id`, `track_id`, `owner_id`, `team_name`, `title`, `tagline`,
`description`, `repo_url`, `demo_url`, `video_url`, `tags[]`, `status`
(`draft` \| `submitted` \| `withdrawn`).

Access: anyone may read `submitted` projects; owners read and edit their own
(including drafts) while submissions are open; organizers may read and edit
everything.

## judges

`event_id`, `user_id` (nullable — a judge can exist before they sign up),
`display_name`, `email`, `active`. Linking an email that already has an account
also grants the `judge` role. Organizers manage; a judge may read their own row.

## conflicts

`judge_id`, `submission_id`, `reason`; unique `(judge_id, submission_id)`.
Excluded from assignment. Organizers manage.

## assignments

`event_id`, `judge_id`, `submission_id`, `status` (`pending` \| `draft` \|
`submitted`), `comment`, `submitted_at`; unique `(judge_id, submission_id)`.

One assignment = one judge reviewing one project. A judge sees only their own
assignments (`owns_assignment`); organizers see all.

## scores

`assignment_id`, `criterion_id`, `value`, unique
`(assignment_id, criterion_id)`. Values are validated against the criterion's
min and max on write, and a review can only be submitted when every criterion is
scored. Readable by the owning judge and by organizers.

## Mesh evidence store

The evidence-first pipeline keeps its tables in the same `public` schema
(`db/migrations/002_mesh.sql`), alongside everything else — one database,
no cross-store references. Access control stays in the application layer:
owners act on their own organisms, organizers decide eligibility.

- `organism_manifests` — one row per ingested manifest: `submission_id`,
  `event_id`, `owner_key` (auth user id), the full signed `manifest` (jsonb),
  `merkle_root`, agent `public_key`, `sealed` flag and `sealed_at`.
- `organism_claims` — `(manifest_id, claim_id)` unique; `statement`,
  `category`, `expected_evidence[]`, `evidence_refs[]`, `status` (`SUPPORTED` |
  `PARTIAL` | `UNVERIFIED` | `CONTRADICTED`, recomputed from links on write).
- `evidence_artifacts` — `(manifest_id, artifact_id)` unique; `kind`,
  `content_hash`, `uri` (references only — hashes and structure, never
  secrets or file contents).
- `claim_links` — `claim_id`, `evidence_id`, `relationship` (`SUPPORTS` |
  `PARTIALLY_SUPPORTS` | `CONTRADICTS` | `CONTEXT`), `confidence` (evidence
  confidence, never quality), `explanation`.
- `replay_runs` — `scenario_id`, `status` (`pending` | `running` | `passed` |
  `failed`), `steps` (jsonb), signed `report` (jsonb).
- `organism_anomalies` — `(manifest_id, anomaly_key)` unique; `severity`,
  `category`, `finding`, `evidence_refs[]`, `allowed_actions[]`, `state`
  (`open` | `explained` | `waived` | `resolved`) plus resolution audit fields.
- `criterion_assessments` — human scores: unique
  `(event_id, submission_id, assessor_key, criterion)`; `score` 1–10,
  `confidence` 1–5, `rationale`, `evidence_refs[]`, `acknowledged_flags[]`.
- `eligibility_decisions` — unique `(event_id, submission_id)`; `status`
  (`ELIGIBLE` | `PROVISIONAL` | `INELIGIBLE` | `MANUAL_REVIEW_REQUIRED`),
  `reason`, `decided_by`. Separate from ranking, never a hidden penalty.

```text
organism_manifests ─┬─ organism_claims
                    ├─ evidence_artifacts ─ claim_links (claim_id, evidence_id)
                    ├─ replay_runs
                    ├─ organism_anomalies
                    ├─ criterion_assessments (event_id, submission_id)
                    └─ eligibility_decisions (event_id, submission_id)
```

## Teams, prizes, media, scopes, audit

Also in `public`, keyed by plain uuid references (validated at the
application layer, no hard cross-domain foreign keys):

- `teams` — `event_id`, `name`, `created_by`.
- `team_members` — `(team_id, user_key)` unique; `role` (`owner` | `member`).
- `team_invites` — `team_id`, high-entropy `token` (unique), `expires_at`
  (30 days), `revoked`, `uses`/`max_uses`.
- `prizes` — `event_id`, `position`, `title`, `amount`; shown on the home page.
- `submission_media` — `submission_id` (primary key), `thumbnail_url`,
  `images[]`; buddy-table for the submission row, owner-verified on write.
- `judge_scopes` — `judge_id` (primary key), `track_id` (nullable). A row
  scopes the judge to one track across assignment, queue, and review writes.
- `audit_events` — append-only `event_id`, `actor`, `action`, `entity`,
  `entity_id`, `detail` (jsonb). Written best-effort, never blocking.
- `rubric_freeze` — one row per event: `frozen`, `frozen_at`, `frozen_by`,
  `weights_hash` (sha256 of the criteria id/name/weight snapshot).

## Custom questions, pairwise, community, webhooks

- `custom_questions` — `event_id`, `label`, `kind` (`text`|`url`|`number`|`boolean`),
  `required`, `position`. Organizer-managed; public to read.
- `submission_answers` — `(submission_id, question_id)` unique, `value` text.
  Owner-verified on write; required answers enforced on submit.
- `pairwise_votes` — `event_id`, `voter_key`, `winner_id`, `loser_id`
  (`winner <> loser`). Ranked with the same Bradley-Terry estimator as the
  aggregate engine.
- `events.voting_mode` (`off`|`one_person_one_vote`|`quadratic`),
  `events.voting_open`, `events.results_published` — standings hidden from
  non-organizers until published.
- `votes` — `(event_id, submission_id, voter_key)` unique, `votes` 1–5.
  Tally is count or sqrt-sum; 30 vote-rows/hour/voter rate cap.
- `comments` — `event_id`, `submission_id`, `author_key`, `body`, `hidden`.
  Organizers hide; 10/hour/author cap.
- `webhook_subscriptions` — `event_id`, `url`, `secret`, `events[]`, `active`.
- `webhook_deliveries` — append-only attempts with `status` and `last_error`.## Relationships

```text
events ─┬─ tracks ──────────┐
        ├─ criteria         │
        ├─ submissions ─────┘  (track_id, owner_id → users)
        ├─ judges (user_id → users)
        └─ assignments (judge_id, submission_id) ─ scores (criterion_id)
                   conflicts (judge_id, submission_id)
```

## Access summary

| Actor | Can |
| --- | --- |
| anonymous | read the event, tracks, criteria, submitted projects |
| participant | the above, plus create and edit their own project while submissions are open |
| judge | the above, plus read and score only the assignments given to them |
| organizer | everything: settings, criteria, tracks, judges, conflicts, assignment rounds, results |
