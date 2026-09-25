# Research Gap & Novelty Document for OpenJudge

Goal: a written research document in the project that names the real, evidenced gap in hackathon
evaluation research and states precisely what is novel about our judging engine — written to be read
by hackathon judges, not journal reviewers.

## What I found in the literature (basis for the gap)

Recent work on hackathon evaluation moves almost entirely in one direction: replace or augment human
judges with AI. Automated LLM leaderboards for hackathon submissions [1](https://doi.org/10.54517/cte3166),
multi-agent bias-mitigated assessment [3](https://doi.org/10.64388/irev9i11-1718010), ML-led jury
reliability studies [2](https://neliti.com/publications/662003/reliability-of-ml-led-jury-evaluation-in-hackathons),
and AI creativity evaluation at scale [4](https://doi.org/10.48550/arxiv.2503.04290).

Meanwhile, the statistics of unfair scoring are a mature, separate literature: reviewer-bias
calibration by maximum likelihood [5](https://doi.org/10.1609/aaai.v25i1.7847), mixed-model score
aggregation [2](https://ideas.repec.org/a/spr/metrik/v79y2016i1p37-57.html), least-squares
calibration [3](https://doi.org/10.48550/arxiv.2110.12607), prior-free calibration
[1](https://doi.org/10.48550/arxiv.2312.07269), and large-scale evidence that a nominal score has no
stable meaning across reviewer pools [6](https://arxiv.org/html/2607.27209). Round-robin judge
assignment is also proven optimal for a fixed judge panel and budget
[5](https://arxiv.org/pdf/2603.01865).

**The gap:** those two bodies of work never meet in a usable system. Calibration is published as
offline statistics on historical datasets; hackathon platforms ship raw averages. Nobody has put
balanced assignment + judge calibration + a transparency audit inside the live scoring tool that
organizers actually run on event day, and nobody has made it self-hostable and inspectable.

## Document structure (RESEARCH.md)

1. **One-page verdict** — the gap in three sentences, our novelty in three sentences. Pitch-ready.
2. **How hackathons are judged today** — raw averages, ad-hoc assignment, no audit trail; the four
   structural failures the literature names (inconsistent rubric use, inter-rater variance,
   assessment latency, no diagnostic feedback).
3. **What research has solved, separately** — table of the AI-evaluation line and the
   calibration-statistics line, with citations and what each leaves open.
4. **The gap statement** — the unbridged space between them, phrased as a testable claim.
5. **Our contribution** — four novelty claims, each mapped to code in this repo:
   - *Calibration at the point of decision*: per-judge z-score correction mapped back to the rubric
     scale, computed live from the event's own reviews, no prior data or training run
     (`src/lib/engine/normalize.ts`).
   - *Fair-by-construction assignment*: deterministic incremental balanced round-robin with
     workload spread ≤ 1, self-review and conflict exclusion, re-runnable mid-event without
     reshuffling in-flight reviews (`src/lib/engine/assignment.ts`).
   - *Auditable outcome, not a black box*: raw rank and adjusted rank shown side by side, per-judge
     harshness/leniency stats exposed to organizers, minimum-review guard flagging
     under-reviewed projects instead of silently ranking them.
   - *Verifiable and self-hostable*: pure engine functions with a test suite that asserts the
     fairness properties, plus one-command self-hosting — so the fairness claim can be inspected
     rather than trusted.
6. **Worked example** — the harsh/lenient two-judge case already in JUDGING.md, showing a rank flip
   that raw averaging gets wrong.
7. **Positioning vs AI judging** — we do not claim AI judges are wrong; we fix the human panel that
   remains the accountable decision-maker, and calibration applies to LLM judges too (they are
   documented as systematically lenient or strict).
8. **Limitations and future work** — z-scores assume enough reviews per judge; cross-track
   comparability, Bayesian/mixed-model calibration, and inter-rater reliability reporting as next
   steps.
9. **References** — numbered, with links.

## Technical notes

- New file `RESEARCH.md` at the project root, linked from the README documentation list.
- No app code, schema, or route changes; the engines and JUDGING.md math are the evidence base, cited
  by file and function name so a judge can open them.
- Citations are to the specific papers found above; no invented sources, no invented metrics — no
  performance numbers are claimed that this repo has not measured.

## Open item

You answered "both" for source material but haven't shared a specific paper. I'll build this from the
literature search above; if you upload the paper you had in mind, I'll fold its stated gap and
limitations into sections 3 and 4.
