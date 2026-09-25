# Research note: what is actually missing in hackathon judging

This note explains the gap OpenJudge is built on, why the obvious answers are already taken, and
what is genuinely new here. It is written to be read by judges of a hackathon, not only by
researchers, so each section states the claim in plain language first.

---

## 1. The problem everybody agrees on

A hackathon has to draw one line: prize winners and everybody else. That line is drawn from a
handful of human impressions collected in a few hours, under time pressure, by judges who never see
the whole field. Three failure modes are well documented:

- **Judge harshness varies.** The same project scores differently depending on who walks up to it.
  The peer-review literature has measured and modelled this for years and proposes calibration by
  quadratic programming [7], statistical bias models [8], least-squares calibration [9], and
  prior-free calibration of "cheap signals" [10]. Review scores are demonstrably not comparable
  across reviewers or areas [11][12].
- **Judges do not see the same projects.** Every project is scored by a different, small subset of
  the panel, so scores are compared across incomparable contexts.
- **Scores are compressed.** Judges cluster their numbers in a narrow band, so the arithmetic
  difference between 2nd and 6th place can be smaller than the noise in a single score.

## 2. Why the obvious answers are already taken

Anyone approaching this problem lands on one of two ideas. Both are occupied.

**Idea A — "let an AI judge it."** Automated leaderboards driven by large language models [1],
ML-led jury reliability studies [2], multi-agent bias-mitigated assessment [3], and AI-collaborative
creativity evaluation at scale [4] all exist. And the AI judge inherits its own biases, which is now
its own research area: cyclic-judge debiasing [5] and measured biases of LLM code judges [6]. An AI
judge changes who is biased, not whether the result can be trusted.

**Idea B — "fix judge bias with better maths."** This is not a gap; it is the incumbent. **Gavel**
[13][14] implements pairwise comparison with a Bayesian Bradley-Terry/Crowd-BT model [15], has run
HackMIT (200+ projects, 100 judges) and hundreds of other events, and has been open source since
2016. A project pitching "we normalise judge scores" is re-pitching a decade-old tool.

**And the incumbent is not enough.** MadHacks simulated their own event against Gavel-style pairwise
judging and reported that the genuinely best project reached the final round only **6%** of the time;
their replacement design raised it to **51%** [16]. Their other finding matters more: judges give
nearly identical scores to most projects, so much of the ordering is noise. Better averaging cannot
repair a signal that thin.

**Where the frontier actually moved.** Recent work asks a different question — not *how do we average
the reviews we have*, but *which comparison should we ask for next*. Bias-aware Bayesian active
top-k ranking [17] chooses the next comparison to shrink uncertainty about who belongs in the top k,
under a fixed comparison budget. No hackathon judging tool does this.

## 3. The gap

Two things are missing from every tool in this space, and one of them is missing from the research
literature too.

1. **Nobody reports how much the result depends on the method.** Every platform picks one
   aggregation rule and prints a leaderboard. None answers the question an organizer actually has:
   *would a different, equally defensible way of counting have produced different winners?* The
   related idea in decision theory — robust winner determination under uncertain aggregation weights
   — has not been applied to human expo judging.
2. **Nobody makes the decision contestable.** A team receives a placing and no way to interrogate
   it. Contestability — the ability of the person affected by a decision to inspect and challenge
   the specific inputs behind it — is named as badly neglected even inside explainability research
   [18]. A hackathon is an ideal, low-stakes place to build it, and nobody has.

**So the gap is not "judges are biased" (known, addressed) and not "let AI judge" (crowded). It is:
no judging system tells you whether to trust its own output, and none lets a team check it.**

## 4. What OpenJudge does that is new

OpenJudge is a **decision-certification layer**. It still produces a leaderboard; the novelty is
what surrounds it.

### A. Decision-robustness certificate

Every prize boundary is recomputed under four defensible rules:

| Rule | What it assumes |
| --- | --- |
| Raw average | Judges' numbers are directly comparable |
| Judge-calibrated average | Each judge has a harshness offset and spread worth correcting (z-scoring) |
| Pairwise Bradley-Terry | Only *within-judge* orderings are trustworthy; absolute numbers are not |
| Rank-based (Borda) | Only each judge's ordering counts; distances are meaningless |

A place is reported `ROBUST` only when all four rules put the same project there. Otherwise it is
`FRAGILE`, and the certificate names the rules that disagree and the projects still in contention.
The organizer sees, per project, its best and worst placing across rules and a bootstrap interval
over its own reviews.

This turns "here is the ranking" into "here is the ranking, and here is which parts of it are an
artefact of the method."

### B. Prize-boundary-targeted review allocation

Judge-hours are the scarce resource. Instead of spreading the next available review evenly,
OpenJudge sends it to the project whose extra review would most likely settle a contested prize
boundary — adapting the active top-k idea [17] from synthetic comparison budgets to a real human
panel, with conflicts, no self-review, and balanced workload preserved.

This is measured, not asserted. The bundled replay harness simulates events with hidden true
quality, harsh and generous judges, and compressed noisy scoring, then checks how often each setup
recovers the truly best project. On a 24-project, 8-judge event (3 reviews per project, 12 extra
reviews, 60 seeded trials), spending those 12 extra reviews where the certificate points found the
true winner **47.5%** of the time versus **28.0%** for spreading the same 12 reviews evenly. These
are synthetic events, not a real hackathon; they are reproducible from
`src/lib/engine/replay.test.ts` and are the only performance numbers this project claims. The
6%/51% figures above belong to MadHacks [16], not to us.

### C. Contestable audit receipt, per team

Every team gets a receipt page for its own project showing: each review it received (judges
anonymised as Judge A, B, C), each judge's measured harshness against the event average, the
calibration applied, the project's placing under all four rules, its confidence interval, and the
robustness verdict for the boundary it sits near. A team can then dispute *one specific input* — a
score, a missing review, a judge who should have been recused — instead of arguing with "the
algorithm."

### D. Replay harness

Organizers can simulate their own event before running it: how many judges, how many reviews per
project, how much harshness variation, which aggregation rule. It answers "is our judging plan good
enough to find our winner?" while there is still time to change it.

### The one-line pitch

> Other judging tools give you a leaderboard. OpenJudge tells you whether to trust it — and gives
> every team the receipt.

## 5. A worked example of a fragile podium

Three projects, three judges, each judge sees two projects:

| Judge | Project A | Project B | Project C |
| --- | --- | --- | --- |
| J1 | 10 | 6 | — |
| J2 | — | 7 | 6 |
| J3 | 1 | — | 10 |

Averages crown **C** (8.0 vs A's 5.5). Every judge's *ordering*, however, forms a cycle: A beats B,
B beats C, C beats A — the rank-based rule crowns **A**. Nothing here is a bug: two reasonable ways
of counting genuinely disagree, because J3's single low score on A carries the whole result. Any
tool that prints one leaderboard hides that. OpenJudge marks first place `FRAGILE`, names A and C as
contenders, and asks a judge who has seen neither to look at A — the one review that resolves it.
This case is pinned as a regression test in `src/lib/engine/robustness.test.ts`.

## 6. Honest limits

- The four rules are defensible, not exhaustive; a fifth rule could disagree with all of them.
- Robustness is not correctness. A `ROBUST` verdict means the result does not depend on the counting
  method; it cannot rescue a panel that all shared the same blind spot.
- Bootstrap intervals over three reviews are wide by nature. That is information, not a defect.
- All performance figures here come from simulated events (§4B). We have not run a real hackathon on
  this system.

---

## References

1. Li et al. *Automated leaderboard system for hackathon evaluation using large language models.*
   Computer and Telecommunication Engineering, 2025. <https://doi.org/10.54517/cte3166>
2. Kuvanbakiyev. *Reliability of ML-led jury evaluation in hackathons.* 2025.
   <https://neliti.com/publications/662003/reliability-of-ml-led-jury-evaluation-in-hackathons>
3. Tripathi et al. *HackEval: an intelligent multi-agent framework for automated, bias-mitigated
   assessment in competitive hackathon ecosystems.* 2026. <https://doi.org/10.64388/irev9i11-1718010>
4. Falk et al. *How do hackathons foster creativity? Towards AI collaborative evaluation of
   creativity at scale.* arXiv, 2025. <https://doi.org/10.48550/arxiv.2503.04290>
5. Zhu et al. *CyclicJudge: mitigating judge bias efficiently in LLM-based evaluation.* arXiv.
   <https://arxiv.org/pdf/2603.01865>
6. Moon et al. *Don't judge code by its cover: exploring biases in LLM judges for code evaluation.*
   Findings of EACL, 2026.
   <https://aclanthology.org/anthology-files/anthology-files/pdf/findings/2026.findings-eacl.70.pdf>
7. Roos, Rothe, Scheuermann. *How to calibrate the scores of biased reviewers by quadratic
   programming.* AAAI, 2011. <https://doi.org/10.1609/aaai.v25i1.7847>
8. Kuhlisch et al. *A statistical approach to calibrating the scores of biased reviewers of
   scientific papers.* Metrika, 2016. <https://ideas.repec.org/a/spr/metrik/v79y2016i1p37-57.html>
9. Tan et al. *Least square calibration for peer review.* arXiv, 2021.
   <https://doi.org/10.48550/arxiv.2110.12607>
10. Lu, Kong. *Calibrating "cheap signals" in peer review without a prior.* NeurIPS, 2023.
    <https://doi.org/10.48550/arxiv.2312.07269>
11. Alarfaj. *Enhancing consistency in peer review: a statistical analysis of discrepancies and
    proposals for improvement.* Learned Publishing, 2025. <https://doi.org/10.1002/leap.2033>
12. Xu et al. *Reviewer scores are not comparable across research areas in ML peer review.* arXiv,
    2026. <https://arxiv.org/html/2607.27209>
13. Athalye. *Gavel: an expo judging system.* 2016.
    <https://anishathalye.com/gavel-an-expo-judging-system/>
14. Gavel source code. <https://github.com/anishathalye/gavel>
15. Athalye. *Implementing a scalable judging system.* 2015.
    <https://anishathalye.com/implementing-a-scalable-judging-system/>
16. *A better judging algorithm for the largest hackathon in Wisconsin.* MadHacks, 2025.
    <https://ben.enterprises/hackathon-judging>
17. *Bias-aware Bayesian active top-k ranking from pairwise comparisons.* arXiv, 2026.
    <https://arxiv.org/abs/2607.02104>
18. *Contestability in algorithmic decision-making: a neglected requirement in explainable AI.*
    arXiv, 2026. <https://arxiv.org/abs/2605.16041>
