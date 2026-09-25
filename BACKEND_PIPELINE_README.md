# OpenJudge Backend Pipeline

## Purpose

OpenJudge is a self-hostable hackathon platform designed to answer two separate questions:

1. **What did the judges score?**
2. **Is the resulting prize decision safe to act on?**

Most platforms provide only a leaderboard. OpenJudge retains the evidence, score inputs, calibration outputs, and ranking-method comparison needed to explain whether a prize boundary is **ROBUST** or **FRAGILE**.

This document explains the backend pipeline for judges, organizers, contributors, and future maintainers. It deliberately separates the acceptance-critical core from an optional evidence-analysis layer. The system remains fully useful when the optional layer is disabled.

## Design principles

- **Offline first:** `docker compose up` starts a seeded, usable platform without hosted databases, managed authentication, external APIs, or network access.
- **Human-governed evaluation:** people score projects. Automation gathers evidence and flags review needs; it never autonomously selects winners.
- **Deterministic decisions:** the same stored inputs and rubric version must reproduce the same rankings and certificate.
- **Contestability:** each meaningful output links back to concrete inputs, rules, and timestamps.
- **Fixed scoring rules:** rubric weights are configured and frozen before judging. Complexity never changes a project's score weight.
- **Privacy by default:** no keystroke logging, background developer surveillance, or secret collection.
- **Layered delivery:** a clean T2 judging engine is more valuable than unfinished advanced features.

---

## 1. System scope and tier alignment

### T1 - Core platform

The backend must support authentication and sessions, role-based access, event setup, teams, editable submissions, deadline enforcement, and a public searchable gallery.

### T2 - Judging integrity (primary differentiator)

The backend must support judge invitations, conflict-aware assignment, configurable weighted rubrics, isolated judge workflows, score normalization, progress dashboards, exports, and a reproducible result pipeline.

The OpenJudge differentiator is implemented here:

```text
raw scores -> calibrated scores -> four ranking views -> boundary certificate
```

### T3 - Public participation

Community voting, comments, randomized ordering, rate limits, duplicate detection, and public audit trails are additive modules. They must not change judge scores unless the organizer explicitly enables a separate, documented voting rule.

### T4 - Extension interfaces

REST APIs, webhooks, signed records, embedded galleries, import/export, and the optional Evidence Lens belong here. They must not compromise the offline core.

---

## 2. Runtime architecture

```text
Browser UI
  |
  v
Application API / authorization boundary
  |
  +--> PostgreSQL (source of truth)
  |
  +--> Domain services (pure business logic)
  |       assignment -> aggregation -> normalization
  |       -> Bradley-Terry -> Borda -> robustness
  |
  +--> Derived computation worker
  |       idempotent, no direct mutation of score inputs
  |
  +--> Optional Evidence Lens worker
          local AST / replay / trace analysis only
```

### Architectural rule: source data vs derived data

| Class | Examples | Write policy |
|---|---|---|
| Source of truth | event, rubric version, assignment, submitted review, conflict, project | normal transactional writes |
| Immutable audit data | review submission timestamp, rubric snapshot, calculation input hash | append-only |
| Derived data | normalized scores, rankings, certificates, dashboard aggregates | recomputable and versioned |
| Optional evidence | local replay result, claim link, anomaly finding | never alters a human score automatically |

The backend must be able to rebuild every derived result from source data and an algorithm version.

---

## 3. Roles and authorization

```text
participant: manage own team and project before deadline; view own receipt
judge:      view only assigned projects; draft and submit own reviews
organizer:  configure event/rubric, invite people, manage conflicts and rounds,
            view results and exports
admin:      platform administration; no implicit right to alter event results
```

Every API handler performs authorization server-side. Hiding a button is not access control.

Critical rules:

- A judge cannot review a project belonging to their team.
- A judge cannot review a declared conflict.
- A participant cannot see judge identities or unpublished results.
- A judge cannot edit a review after final submission unless an organizer explicitly reopens it; reopening is audited.
- An organizer cannot silently alter finalized scores. Any correction creates an audit event and recomputes derived outputs.

---

## 4. Core data model

The exact SQL schema can vary, but the following entities and relationships are required.

```text
users --< team_members >-- teams --< projects --< project_versions
  |                              |
  |                              +--< submissions
  |
  +--< event_roles >-- events --< rubric_versions --< rubric_criteria
                              |
                              +--< judge_assignments >-- reviews --< review_scores
                              |
                              +--< conflicts
                              +--< calculation_runs --< ranking_results
                                                   +--< robustness_certificates
```

### Essential records

```ts
type Event = {
  id: string;
  name: string;
  timezone: string;
  submissionOpensAt: string;
  submissionClosesAt: string;
  judgingOpensAt: string;
  judgingClosesAt: string;
  status: "DRAFT" | "SUBMISSIONS_OPEN" | "JUDGING_OPEN" | "RESULTS_FINAL";
};

type RubricVersion = {
  id: string;
  eventId: string;
  version: number;
  status: "DRAFT" | "FROZEN" | "RETIRED";
  createdAt: string;
  frozenAt?: string;
  inputHash: string;
};

type RubricCriterion = {
  id: string;
  rubricVersionId: string;
  key: string;
  label: string;
  description: string;
  weight: number; // all enabled weights must sum to 1
  minScore: 1;
  maxScore: 10;
  displayOrder: number;
};

type JudgeAssignment = {
  id: string;
  eventId: string;
  judgeId: string;
  projectId: string;
  round: number;
  status: "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "VOID";
  assignedAt: string;
};

type Review = {
  id: string;
  assignmentId: string;
  rubricVersionId: string; // immutable snapshot link
  status: "DRAFT" | "SUBMITTED" | "REOPENED";
  submittedAt?: string;
  rationale: string;
};

type ReviewScore = {
  reviewId: string;
  criterionId: string;
  rawScore: number; // integer 1..10
  confidence: 1 | 2 | 3 | 4 | 5;
  rationale: string;
};
```

### Invariants enforced in database and service logic

1. A frozen rubric cannot be edited.
2. Review scores are integers in the criterion range.
3. A submitted review contains exactly one score for every enabled criterion.
4. An assignment is unique by `(event_id, judge_id, project_id, round)`.
5. A conflict prevents assignment creation.
6. Projects cannot be submitted or edited after the submission deadline unless an explicit audited extension exists.
7. Derived calculation runs store the rubric version, algorithm version, and source-input hash.

---

## 5. Submission pipeline

### Required T1 submission

The normal submission is intentionally conventional and reliable:

```ts
type ProjectSubmission = {
  projectId: string;
  title: string;
  summary: string;
  trackId?: string;
  repositoryUrl: string;
  demoUrl?: string;
  videoUrl?: string;
  imageUrl?: string;
  submittedAt?: string;
  version: number;
};
```

Submission state machine:

```text
DRAFT -> SUBMITTED -> LOCKED
  ^         |
  |         +-> DRAFT (only while submission window is open)
  +---------+
```

Every save increments `version`. Submit validates required fields and deadline in one transaction.

### Optional: Local Evidence Lens

The Evidence Lens is a non-blocking extension. It may accept a locally available source tree or a permitted repository checkout and produce:

- AST/dependency summaries;
- test and replay evidence;
- claim-to-evidence links;
- accessibility or configuration anomalies;
- an evidence sufficiency signal.

It is **not** required to submit, does not affect eligibility automatically, and never modifies review scores. Disable it completely with a feature flag.

### Evidence Lens modalities

| Modality | What is captured | What a judge can inspect |
|---|---|---|
| AST constellation | Language-neutral AST graph, dependency edges, symbols, tests, and migrations | Architecture, ownership boundaries, dead-code candidates, and risky dependency hubs |
| Replay capsule | Network-isolated executable environment, seeded data, and declared scenario contract | Re-run a claim rather than relying only on a demo |
| Continuous state capture | Optional milestone checkpoints hashed into a timeline | Project evolution without keystroke capture or invasive telemetry |
| Interaction trace | Browser events, API spans, screenshots, accessibility tree, and console events | A replayable journey from user action to visible outcome |
| Spatial demo scene | Optional annotated canvas with screen regions, data-flow anchors, narration cues, and before/after states | Enter a relevant demo moment rather than scrub through a video |
| Claim-evidence graph | Links from each claim to test runs, code regions, demo moments, and documentation | Unsupported claims and contradictory evidence |

All six modalities are optional and must remain local or self-hosted. They cannot require a cloud account, an external API, a proprietary analysis service, or live network access.

---

## 6. Judge assignment pipeline

Assignment must balance workloads while protecting conflicts and self-review exclusion.

### Inputs

- active eligible projects;
- active judges;
- requested reviews per project;
- declared conflicts;
- team membership;
- prior assignments;
- current per-judge workload.

### Algorithm requirements

1. Exclude ineligible judge-project pairs.
2. Target equal review count per project.
3. Keep judge workload difference at most one whenever feasible.
4. Re-running the algorithm fills missing assignments rather than duplicating existing ones.
5. Produce a diagnostics report when a complete balanced assignment is impossible.

```text
Build eligible edges
  -> preserve valid existing assignments
  -> allocate lowest-workload eligible judge to highest-need project
  -> persist in a transaction
  -> validate no conflict/self-review and workload bounds
```

For the first implementation, a deterministic greedy algorithm with stable tie-breaking is preferable to an opaque optimizer. Record the assignment seed and input hash for replayability.

---

## 7. Scoring pipeline

### Default rubric

The organizer may configure the rubric before it is frozen. A defensible default is:

| Criterion | Weight |
|---|---:|
| Impact | 0.25 |
| Innovation | 0.20 |
| Technical Execution | 0.30 |
| Design | 0.15 |
| Presentation & Evidence | 0.10 |

The weights must sum to exactly `1.00`. The values are event configuration, not per-project adjustments.

### Per-review calculation

Given a raw human score `x` from 1 to 10, normalize it to the closed interval `[0, 1]`:

```text
s(j, p, k) = (x(j, p, k) - 1) / 9
```

Calculate the weighted normalized result:

```text
q(j, p) = sum(weight(k) * s(j, p, k))
```

Convert it back to a familiar 1-10 score for display:

```text
Q(j, p) = 1 + 9 * q(j, p)
```

Judge confidence is stored for review targeting and uncertainty display. It must not multiply or otherwise secretly change a judge's score.

### Evidence signals

Evidence signals create visible prompts, not hidden deductions:

| Finding | Backend action |
|---|---|
| Core demo fails in valid replay | show judge-visible execution cap policy if enabled |
| Claim is contradicted | require judge acknowledgment before review submission |
| Critical security/privacy finding | set `MANUAL_REVIEW_REQUIRED` for organizers |
| Accessibility evidence incomplete | prompt the Design reviewer |
| High innovation, low execution | show “promising but unproven” prompt only |

---

## 8. Aggregation and ranking pipeline

All ranking methods consume the exact same submitted human review dataset. No method receives a private modifier.

```text
submitted reviews
  -> validate complete rubric snapshot
  -> per-review weighted score
  -> raw average
  -> judge-calibrated average
  -> pairwise Bradley-Terry
  -> rank-based Borda
  -> compare prize boundaries
  -> issue robustness certificate
```

### 8.1 Raw weighted average

For each project, average `Q(j, p)` across submitted valid reviews. This is intuitive, but can be affected by harsh or generous judges.

### 8.2 Judge-calibrated average

For each judge, calculate their mean and standard deviation across completed review scores. Transform each score to a z-score, then map it back to the event score scale.

```text
z(j, p) = (Q(j, p) - mean(j)) / sd(j)
```

Implementation safeguards:

- do not calibrate a judge with too few completed reviews;
- use an epsilon or fallback when standard deviation is zero;
- report raw and calibrated rank side by side;
- never overwrite raw scores.

### 8.3 Pairwise Bradley-Terry

For judges who reviewed multiple projects, derive pairwise observations from their weighted scores. A project with the higher score becomes the winner of that comparison; exact ties are either excluded or represented as half-wins by a declared rule.

Estimate latent project strengths `theta` such that:

```text
P(project A beats project B) = exp(thetaA) / (exp(thetaA) + exp(thetaB))
```

Store convergence diagnostics, iteration limit, tie policy, and the input hash. If the comparison graph is disconnected, return an explicit warning instead of pretending the ranking is global.

### 8.4 Rank-based Borda

For each judge, rank their assigned projects by weighted score. Allocate Borda points according to the predeclared tie rule. Sum points per project.

This method depends on ordering rather than score magnitude and helps reveal whether a decision is sensitive to score-scale interpretation.

---

## 9. Decision-robustness certificate

A prize boundary compares the last project inside an award threshold with the first project outside it. A boundary is robust only when all configured methods agree on its ordering.

```ts
type RobustnessCertificate = {
  eventId: string;
  calculationRunId: string;
  boundary: { award: string; aboveProjectId: string; belowProjectId: string };
  verdict: "ROBUST" | "FRAGILE";
  methods: {
    rawAverage: "ABOVE" | "BELOW" | "TIE";
    calibratedAverage: "ABOVE" | "BELOW" | "TIE";
    bradleyTerry: "ABOVE" | "BELOW" | "TIE" | "UNAVAILABLE";
    borda: "ABOVE" | "BELOW" | "TIE" | "UNAVAILABLE";
  };
  contenders: string[];
  explanation: string;
  inputHash: string;
  algorithmVersion: string;
  createdAt: string;
};
```

`ROBUST` does not mean objectively correct; it means the predeclared defensible rules agree. `FRAGILE` does not accuse a project of wrongdoing; it means the boundary needs scrutiny, more reviews, or a documented organizer decision.

### Targeted review allocation

When a boundary is fragile, the system may recommend the next review assignment for the project pair most likely to settle it. This recommendation must still obey conflicts, workload balancing, and event deadlines.

---

## 10. Computation lifecycle and idempotency

Every calculation uses a snapshot of source inputs.

```text
event changes / review submitted / assignment changed
  -> append audit event
  -> enqueue recalculation with event id and source-input hash
  -> compute in isolation
  -> persist new calculation run
  -> publish latest eligible run
```

```ts
type CalculationRun = {
  id: string;
  eventId: string;
  sourceInputHash: string;
  rubricVersionId: string;
  algorithmVersion: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt?: string;
  completedAt?: string;
  error?: string;
};
```

If a run already exists with the same event, input hash, and algorithm version, reuse it. This makes retries safe and avoids contradictory output.

---

## 11. Audit receipt and exports

### Team receipt

After results publication, each team can view:

- their per-criterion scores and written feedback;
- anonymized judge identifiers;
- raw and calibrated outcomes;
- rank under each method;
- confidence interval or reviewer-agreement summary;
- the relevant robustness certificate;
- the rubric version and calculation timestamp.

### Organizer export

CSV exports must include filtered, permission-appropriate data for:

- projects and submission status;
- assignments and judge workloads;
- reviews and rubric scores;
- raw/calibrated rankings;
- certificate results;
- audit events.

No export should leak secret tokens, raw passwords, or participant-private data beyond the organizer’s legitimate scope.

---

## 12. Security, privacy, and abuse controls

### Required controls

- Passwords are salted and hashed; sessions use secure, expiring tokens or server-side sessions.
- Server-side authorization applies to every read and write.
- Rate-limit login, invitation acceptance, voting, comments, and submission updates.
- Validate and sanitize all user input.
- Use parameterized SQL or a safe query layer.
- Audit sensitive mutations: roles, deadlines, rubric freeze, conflicts, assignments, review reopen, result publication.
- Generate signed or high-entropy invite links; allow revocation.

### Threat-model focus

| Threat | Mitigation |
|---|---|
| Sybil voting | authenticated participation, rate limit, duplicate heuristics, audit events |
| Ballot stuffing | one vote policy, server-side uniqueness, anomaly review |
| Judge collusion | conflict declarations, assignment isolation, audit records, normalized/raw comparison |
| Submission scraping | public visibility controls, rate limits, no secret data in gallery payloads |
| Deadline gaming | server-authoritative timestamp and immutable submission history |
| Score tampering | frozen rubrics, append-only review audit, deterministic recomputation |

---

## 13. Operational requirements

The acceptance command is:

```bash
docker compose up
```

The deployment must:

- configure Compose so this command starts the application and local database from the checked-out project;
- start PostgreSQL and the application locally;
- apply migrations automatically or through a documented local step;
- load fixture data when enabled;
- run with no network connection after images/dependencies are available;
- expose a predictable local port;
- avoid hosted identity, database, analytics, or AI dependencies.

### Acceptance-rule compliance checklist

| Event rule | Pipeline position | Backend implementation requirement |
|---|---|---|
| One-command working portal | Required | `docker compose up` starts the app, database, migrations, and seeded demo data locally |
| No hosted database | Required | PostgreSQL runs as a Compose service; connection string points only to that local service |
| No Authentication-as-a-Service | Required | Local application authentication, local session storage, and password hashing are used |
| No external APIs or cloud accounts | Required | No runtime dependency on remote AI, analytics, identity, database, storage, or repository APIs |
| No proprietary services | Required | All required components are open-source and bundled/configured locally |
| Offline operation | Required | Core event lifecycle and all T1/T2 flows work with network disabled |
| Acceptance suite and report | Required | Automated acceptance tests generate `acceptance-report.txt`, committed to the public repository |
| Optional Evidence Lens | Conditional | It is disabled by default or functions using only local containers and local artifacts |

Recommended health checks:

```text
GET /health/live    -> process is running
GET /health/ready   -> database migrated and reachable
GET /health/version -> app and algorithm versions
```

---

## 14. Test strategy

### Unit tests

- rubric validation and score normalization;
- zero-variance normalization fallback;
- assignment conflict exclusion and workload balance;
- Borda tie handling;
- Bradley-Terry convergence and disconnected graph warning;
- robust/fragile boundary classification;
- authorization rules and deadline behavior.

### Integration tests

- organizer creates event and freezes rubric;
- participant forms a team and submits a project;
- organizer declares conflict and generates assignments;
- judges submit reviews;
- worker creates all four ranking outputs and certificates;
- participant receipt respects anonymity;
- CSV export permissions are correct.

### Acceptance demonstration

Seed a complete event lifecycle so a judge can observe:

```text
event setup -> teams -> submissions -> assignments -> reviews
-> ranking methods -> fragile/robust certificate -> audit receipt
```

The acceptance report should state which tier requirements pass, any intentional gaps, and the commands used to verify them.

---

## 15. Recommended delivery order

1. Docker, database, migrations, seed data, authentication, and roles.
2. Events, teams, draft submissions, deadline enforcement, gallery.
3. Configurable rubric, conflict management, deterministic assignment.
4. Judge console, draft/final review submission, progress dashboard, CSV export.
5. Raw average and calibrated average with tests.
6. Bradley-Terry, Borda, robustness certificate, and contestable receipt.
7. Threat model and API/OpenAPI documentation.
8. Optional voting, Evidence Lens, webhooks, embed widget, and signed records.

At each checkpoint, ask: **if development stopped now, would the completed system pass the current tier cleanly?**

---

## 15b. Implementation status (this repo)

- **Offline backend — done (was the adoption blocker).** No cloud accounts, no
  Auth-as-a-Service, no hosted database. Local email+password accounts
  (scrypt in `users`), opaque session cookies (`sessions`,
  `POST /api/auth/*`), and every read/write in self-host Postgres via `pg`.
  `docker compose up` works fully offline after images are built. Supabase
  references are fully removed from code, config, and dependencies.
- **T1 Core — working.** Local auth/sessions, 3 roles (organizer absorbs
  admin), event creation + switcher, prizes, teams + invite links, draft/edit
  submissions with fixed payload mapping (`src/lib/submit-payload.ts`),
  server-side deadline guard, public gallery with search + track filter,
  detail pages with thumbnail/gallery, health endpoints
  (`/health/live|ready|version`).
- **T2 Judging integrity — working.** Judge invite + email linking, round-robin
  assignment with conflict/self-review/track-scope exclusion, configurable
  criteria weights, server-enforced isolation (SQL predicates on every read
  and write, verified by auth-gate e2e), judge console with draft/final +
  evidence strips, organizer per-judge progress (`x/y reviews submitted`),
  normalization with raw vs calibrated side-by-side, CSV at every stage
  (assignments, reviews, results), decision certificate + prize-boundary
  review targeting, rubric freeze + append-only audit log with admin viewer.
  Evidence Lens wired into T2: six modalities
  (`MODALITIES` in `src/lib/engine/manifest.ts`) with per-organism coverage
  (`getOrganism` → `modalities`), milestone timeline + trace/scene viewers on
  the receipt (`ModalitiesPanel`).
- **T3 Public participation — not implemented** (no voting, comments, audit trails).
  Claimed honestly as out of scope.
- **T4 Extensions — partially implemented.** No REST/OpenAPI, webhooks, or embed
  widget. Implemented instead: signed ed25519 manifests + Merkle seal, replay
  reports, CSV exports, evidence sufficiency/robustness certificates, health
  + local auth JSON APIs. Claimed honestly as partial.

---

## 16. Judge-facing explanation

> OpenJudge does not ask judges to trust a black box. Judges provide the scores. The platform preserves those scores, accounts for systematic scoring differences, compares multiple defensible ranking rules, and shows whether a prize boundary remains stable under those rules. When it does not, OpenJudge labels the decision as fragile and identifies the evidence needed to resolve it.

That is the pipeline's central promise: **transparent human judgment, reproducible computation, and decisions that can be challenged with specific evidence.**
