# Sharper Novelty: from "we normalize scores" to "we certify the decision"

The deeper search changed the picture. Our current novelty claim is not safe, and the honest fix
makes the project stronger.

## What the deeper search found

**1. Our calibration angle is already the incumbent, and it is already beaten.**
Pairwise Bayesian judging (Crowd-BT / Bradley-Terry) ships today as **Gavel**, used at HackMIT,
HackHarvard and many others [1](https://anishathalye.com/implementing-a-scalable-judging-system/),
[2](https://devpost.com/software/bayesian-ranking). Any team pitching "we fix judge bias with better
maths" is re-pitching a 2015 open-source tool.

**2. The incumbent fails badly, and someone measured it.**
MadHacks simulated their event: under Gavel the genuinely top project reached the final round only
**6% of the time**; their replacement got it to **51%** [3](https://ben.enterprises/hackathon-judging).
They also document the failure our raw-average critique misses — judges give nearly identical scores
across projects, so place differences come from noise.

**3. The frontier moved to *which comparison to ask next*, not *how to average*.**
Bias-aware Bayesian **active top-k** ranking picks the next comparison to reduce uncertainty about
who is in the top k, under a fixed judging budget [4](https://arxiv.org/html/2607.02104v1). No
hackathon tool does this.

**4. Two things nobody has built anywhere.**
Social choice theory has robust winner determination — minimax regret when aggregation weights are
uncertain [5](https://ideas.repec.org/p/hal/journl/hal-02373399.html), robustness of aggregation
under noise [6](https://procaccia.info/wp-content/uploads/2007/05/robust.pdf). And algorithmic
**contestability** — letting a subject review and challenge a decision — is named as badly neglected
even inside explainability research [7](https://arxiv.org/html/2605.16041). Neither exists in any
judging platform.

## The real gap, and our unique claim

> Every existing system, ours included, answers "what is the ranking?" **Nobody answers "is this
> ranking safe to act on, and can a team challenge it?"**

So OpenJudge stops competing on the scoring formula and becomes the **decision-certification layer**
for hackathon judging. Four things no other project or platform does:

### A. Decision-robustness certificate
Recompute the outcome under four aggregation rules — raw average, judge-calibrated average, pairwise
Bradley-Terry, and rank-based (Borda/median) — then report whether the winner and each prize boundary
**survives all of them**. Output: `ROBUST` (same winner every rule), `FRAGILE` (winner changes), with
the exact rules that disagree. Organizers get "your 1st place is stable, but 3rd vs 4th flips under
two of four rules — get one more review on these two."

### B. Prize-boundary-targeted review allocation
Instead of spreading reviews uniformly, direct the next available review at the pair whose outcome is
most uncertain **near a prize cutoff**. Adapts the active top-k idea [4](https://arxiv.org/html/2607.02104v1)
to human panels and a finite judging window. Same number of judge-hours, far higher chance the right
project wins — directly attacking the 6%-vs-51% failure.

### C. Contestable audit receipt, per team
Every team gets their own record: which judges saw them (anonymised IDs), each judge's measured
harshness, the calibration applied to their scores, their score's confidence interval, their rank
under all four rules, and their robustness verdict. A team can dispute a specific input, not just
"the algorithm". This is algorithmic contestability [7](https://arxiv.org/html/2605.16041) applied
where nobody has applied it.

### D. Replay harness
Simulate the event under different judge counts, review budgets, harshness profiles, and aggregation
rules — so an organizer can prove *before* the event that their setup will surface the best project,
and *after* it that the result was not an artefact of the rules.

Pitch line: **"Other judging tools give you a leaderboard. OpenJudge tells you whether to trust it —
and gives every team the receipt."**

## What gets built

**New engine modules (pure, tested, same style as the existing ones)**
- `src/lib/engine/aggregate.ts` — the four aggregation rules over the same review data, including a
  lightweight Bradley-Terry fit derived from rubric scores (pairwise preferences induced per judge).
- `src/lib/engine/robustness.ts` — `certifyDecision()`: ranks under every rule, per-position agreement,
  `ROBUST`/`FRAGILE` verdict per prize boundary, bootstrap confidence interval per project, and a
  ranked list of "reviews that would most reduce fragility".
- `src/lib/engine/targeting.ts` — `nextReviewTargets()`: given current reviews, judge availability and
  the prize cutoff, returns the ordered list of project/judge pairs worth reviewing next, respecting
  the existing conflict, self-review and load-balance rules.
- `src/lib/engine/replay.ts` — deterministic simulation: synth judges with configurable harshness and
  noise, run assignment + scoring + each aggregation rule, report how often the true-best project wins.
- Tests for each, including a regression test reproducing the "noise decides the podium" failure and
  showing targeted allocation beating uniform allocation on the same review budget.

**Server + UI**
- `src/lib/organizer.functions.ts` — add `decisionCertificate()` and `reviewTargets()`.
- Organizer dashboard: a **Decision confidence** panel (verdict per prize position, rules that
  disagree, confidence intervals, "next reviews that matter most" list).
- `src/lib/participant.functions.ts` + a `/receipt/$projectId` route: the team's audit receipt.
- Judge console: surface targeted assignments first, so judges spend effort where it changes outcomes.

**Docs**
- Rewrite `RESEARCH.md` around this gap: the Gavel incumbent, the 6%/51% evidence, the active-top-k
  frontier, the robustness and contestability blind spots, and our four claims with the worked
  fragile-podium example.
- `JUDGING.md`: add the aggregation rules, the robustness certificate definition, and the targeting rule.
- `README.md`: lead with decision certification rather than normalization.

## Technical notes

- Keeps everything already built — calibration becomes one of four rules being compared, not the pitch.
- Bradley-Terry is fitted with plain iterative MM updates on induced pairwise preferences; no new
  dependency, no solver, deterministic and testable.
- Confidence intervals come from a seeded bootstrap over reviews, so results are reproducible.
- No schema change is required for A, B and D. The audit receipt reads existing scores and assignments;
  only a read policy for a team's own review metadata may need adding.
- Existing 22 unit/acceptance tests and 5 browser tests must stay green.

## Honesty guardrails

No claimed performance numbers except what the replay harness measures in this repo, and the harness
uses synthetic events — that is stated plainly. The 6%/51% figure is cited to MadHacks, never
presented as ours.
