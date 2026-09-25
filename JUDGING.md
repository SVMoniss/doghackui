# Judging: assignment and normalization

## 1. Balanced round-robin assignment

`src/lib/engine/assignment.ts` → `planAssignments()`. Pure function, no I/O, so it
is unit tested and also used by the seed data.

Inputs: submitted projects, active judges, `reviewsPerSubmission`, assignments
that already exist, and declared conflicts of interest.

Guarantees:

1. **Coverage** — every project reaches `reviewsPerSubmission` independent
   reviews, or is reported in `shortfalls` when the judge pool is too small.
2. **Balance** — judge workloads differ by at most one review
   (`loadSpread(loads) <= 1` whenever coverage is reachable).
3. **No self-review** — a judge is never assigned a project their own account
   owns.
4. **Conflicts excluded** — any `(judge, project)` pair in `conflicts` is skipped.
5. **Deterministic and incremental** — same inputs produce the same plan, and
   re-running only adds the pairs that are missing. Reviews already in flight are
   never moved.

Method: projects are walked in a stable order; for each open review slot the
eligible judge with the lowest current load wins, ties broken by stable judge
order. Existing assignments seed the load counters, which is what makes a re-run
additive rather than a reshuffle.

## 2. Normalization

`src/lib/engine/normalize.ts` → `normalizeScores()`.

### Step 1 — weighted total per review

For a review with score `s_c` on criterion `c` of weight `w_c`:

```text
rawTotal = Σ (w_c · s_c) / Σ w_c
```

With the default five equal-weight criteria this is just the mean of the five
scores, so totals stay on the familiar 1–10 scale.

### Step 2 — per-judge z-score, mapped back to the scale

For judge `j` with mean `μ_j` and standard deviation `σ_j` across their own
reviews, and event-wide mean `μ` and standard deviation `σ`:

```text
z            = (rawTotal − μ_j) / σ_j          (0 when σ_j = 0)
normalized   = μ + z · σ
```

When the event-wide spread is zero, the fallback is `rawTotal − bias_j` where
`bias_j = μ_j − μ`. A negative bias means a harsh judge, positive means lenient.

### Step 3 — project score and ranks

A project's raw and normalized scores are the means of its own reviews. Both are
ranked, and both ranks are reported so organizers can see exactly what
normalization changed.

### Step 4 — minimum review guard

Projects with fewer than `reviewsPerSubmission` submitted reviews are flagged
`underReviewed`. They still appear, marked in the dashboard and CSV, rather than
being silently ranked against fully reviewed projects.

## 3. Worked example

Two judges, one criterion, scale 1–10.

| Review | Judge | Project | Raw |
| --- | --- | --- | --- |
| 1 | Harsh | A | 5 |
| 2 | Harsh | B | 3 |
| 3 | Lenient | A | 9 |
| 4 | Lenient | B | 10 |

- Harsh: μ = 4.0, σ = 1.0 · Lenient: μ = 9.5, σ = 0.5
- Overall: μ = 6.75, σ ≈ 2.86

| Review | z | Normalized |
| --- | --- | --- |
| Harsh → A | +1.0 | 9.61 |
| Harsh → B | −1.0 | 3.89 |
| Lenient → A | −1.0 | 3.89 |
| Lenient → B | +1.0 | 9.61 |

Project A raw 7.0, normalized 6.75. Project B raw 6.5, normalized 6.75. Raw
scores rank A above B purely because the lenient judge happened to prefer B;
after normalization the two are tied, which is what the underlying agreement
actually supports.

## 4. Aggregation rules

`src/lib/engine/aggregate.ts` → `aggregateAll()` ranks the field under four rules,
each with a different assumption about what judge numbers mean:

| Rule id | Label | Assumption |
| --- | --- | --- |
| `rawAverage` | Raw average | Judge numbers are directly comparable |
| `calibrated` | Judge-calibrated average | Each judge has a harshness offset and spread worth correcting (§2) |
| `bradleyTerry` | Pairwise (Bradley-Terry) | Only within-judge orderings are trustworthy; fitted by MM iteration on pairs induced from each judge's own reviews |
| `borda` | Rank-based (Borda) | Only each judge's ordering counts; distances are meaningless |

All four are pure, deterministic and dependency-free.

## 5. Decision-robustness certificate

`src/lib/engine/robustness.ts` → `certifyDecision()`.

For each prize position `1..prizePositions` it compares the project each rule puts
there:

- **ROBUST** — all four rules name the same project.
- **FRAGILE** — they do not. The verdict lists the disagreeing rules and every
  project still in contention for that place, with how many rules back it.

The overall verdict is `ROBUST` only when every prize position is robust. Per
project the certificate also reports its placing under each rule, its best, worst
and mean placing, the rank spread, and a bootstrap interval (400 seeded resamples
of that project's own review totals). Projects below the minimum review count are
flagged `underReviewed`.

## 6. Prize-boundary-targeted review allocation

`reviewPriority()` scores each project by how much an extra review would help
settle a contested boundary: contention at a prize cutoff, wide rank spread across
rules, a wide bootstrap interval, and too few reviews.

`src/lib/engine/targeting.ts` → `nextReviewTargets()` turns those priorities into
concrete `(judge, project)` pairs, greedily and deterministically, honouring the
same guarantees as §1: no self-review, no conflicts, no duplicate assignment,
balanced load, and at most `maxExtraPerJudge` extra reviews per judge. Targeted
assignments surface first in the judge console with a "decides a prize" badge.

## 7. Replay harness

`src/lib/engine/replay.ts` simulates a whole event from hidden true quality plus
harsh/generous judges, score compression and noise, then measures how often each
aggregation rule recovers the true winner and the true top three.
`compareAllocation()` spends the same extra-review budget targeted versus evenly
and compares the outcomes. Numbers reported in `RESEARCH.md` §4B come from here.

## 8. Tests

```sh
bunx vitest run
```

`src/lib/engine/assignment.test.ts` covers coverage, balance, self-review,
conflicts, determinism, incremental re-runs and shortfall reporting.
`src/lib/engine/normalize.test.ts` covers weighting, harsh/lenient correction,
tie handling, the zero-variance fallbacks, rank reporting and the minimum review
guard. `aggregate.test.ts` covers the four rules and the Bradley-Terry fit,
`robustness.test.ts` covers robust and fragile verdicts (including the cyclic
panel from `RESEARCH.md` §5) plus review priorities, and `replay.test.ts` covers
the simulation and the targeted-versus-even comparison.
