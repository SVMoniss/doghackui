/**
 * Replay harness.
 *
 * An organizer cannot tell whether their judging setup would have surfaced the
 * best project, because the "true" ranking is never observable at a real event.
 * In simulation it is: we invent hidden project quality, let synthetic judges
 * with configurable harshness and noise score against it, and measure how often
 * each aggregation rule and each allocation strategy actually crowns the best
 * project.
 *
 * Everything is seeded, so a replay is reproducible and can be cited.
 */

import { loadSpread, planAssignments } from "./assignment";
import { aggregateAll, type RuleId, type RuleRanking } from "./aggregate";
import type { Criterion, Review } from "./normalize";
import { mulberry32, normal } from "./random";
import { certifyDecision } from "./robustness";
import { nextReviewTargets } from "./targeting";

export type ReplayConfig = {
  projectCount: number;
  judgeCount: number;
  reviewsPerProject: number;
  criteriaCount?: number;
  /** spread of judge harshness offsets on the 1-10 scale */
  harshnessSpread?: number;
  /** per-score random noise */
  noise?: number;
  /** how compressed judge scoring is (real judges cluster their scores) */
  compression?: number;
  seed?: number;
  /** extra reviews available after the first round */
  extraReviews?: number;
  /**
   * How the extra reviews are spent: "targeted" sends them where the
   * certificate says a prize hangs in the balance, "uniform" spreads them
   * evenly over the field. Same budget either way.
   */
  extraMode?: "targeted" | "uniform";
  prizePositions?: number;
};

export type ReplayOutcome = {
  trueOrder: string[];
  rankings: RuleRanking[];
  loadSpread: number;
  /** rule -> did it put the truly best project first */
  top1: Record<RuleId, boolean>;
  /** rule -> how many of the true top-3 landed in its top-3 */
  top3Overlap: Record<RuleId, number>;
};

const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, "0")}`;

function buildCriteria(count: number): Criterion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: id("c", i + 1),
    name: `Criterion ${i + 1}`,
    weight: 1,
    minScore: 1,
    maxScore: 10,
  }));
}

/** One synthetic event. */
export function simulateEvent(config: ReplayConfig): ReplayOutcome {
  const {
    projectCount,
    judgeCount,
    reviewsPerProject,
    criteriaCount = 5,
    harshnessSpread = 1.5,
    noise = 1,
    compression = 0.5,
    seed = 1,
    extraReviews = 0,
    extraMode = "targeted",
    prizePositions = 3,
  } = config;

  const rand = mulberry32(seed);
  const criteria = buildCriteria(criteriaCount);

  const projects = Array.from({ length: projectCount }, (_, i) => ({
    id: id("p", i + 1),
    // Hidden true quality, evenly spread so there is a real answer to find.
    quality: 1 + (9 * i) / Math.max(1, projectCount - 1),
  }));
  const trueOrder = projects
    .slice()
    .sort((a, b) => b.quality - a.quality)
    .map((p) => p.id);

  const judges = Array.from({ length: judgeCount }, (_, i) => ({
    id: id("j", i + 1),
    offset: normal(rand) * harshnessSpread,
    // A generous judge compresses the top of the scale, a harsh one the bottom.
    scale: 1 - compression * (0.5 + 0.5 * normal(rand) * 0.2),
  }));
  const judgeById = new Map(judges.map((j) => [j.id, j]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const score = (judgeId: string, projectId: string): Record<string, number> => {
    const judge = judgeById.get(judgeId)!;
    const project = projectById.get(projectId)!;
    const centre = 5.5 + (project.quality - 5.5) * judge.scale + judge.offset;
    const scores: Record<string, number> = {};
    for (const criterion of criteria) {
      const raw = centre + normal(rand) * noise;
      scores[criterion.id] = Math.min(10, Math.max(1, Math.round(raw)));
    }
    return scores;
  };

  const plan = planAssignments({
    submissions: projects.map((p) => ({ id: p.id })),
    judges: judges.map((j) => ({ id: j.id })),
    reviewsPerSubmission: reviewsPerProject,
  });

  const reviews: Review[] = plan.created.map((pair) => ({
    judgeId: pair.judgeId,
    submissionId: pair.submissionId,
    scores: score(pair.judgeId, pair.submissionId),
  }));

  let allPairs = plan.created.slice();

  if (extraReviews > 0) {
    const certificate = certifyDecision({
      criteria,
      reviews,
      submissionIds: projects.map((p) => p.id),
      prizePositions,
      minReviews: reviewsPerProject,
      seed,
    });
    const suggestions =
      extraMode === "targeted"
        ? certificate.suggestions
        : // Uniform baseline: every project equally deserving, round-robin order.
          projects.map((project, index) => ({
            submissionId: project.id,
            priority: projects.length - index,
            reasons: [],
          }));
    const targets = nextReviewTargets({
      submissions: projects.map((p) => ({ id: p.id })),
      judges: judges.map((j) => ({ id: j.id })),
      existing: allPairs,
      suggestions,
      maxTargets: extraReviews,
      maxExtraPerJudge: Math.max(1, Math.ceil(extraReviews / Math.max(1, judgeCount))),
    });
    for (const target of targets) {
      reviews.push({
        judgeId: target.judgeId,
        submissionId: target.submissionId,
        scores: score(target.judgeId, target.submissionId),
      });
      allPairs.push({ judgeId: target.judgeId, submissionId: target.submissionId });
    }
  }

  const rankings = aggregateAll({
    criteria,
    reviews,
    submissionIds: projects.map((p) => p.id),
  });

  const loads: Record<string, number> = {};
  for (const judge of judges) loads[judge.id] = 0;
  for (const pair of allPairs) loads[pair.judgeId] = (loads[pair.judgeId] ?? 0) + 1;

  const top1 = {} as Record<RuleId, boolean>;
  const top3Overlap = {} as Record<RuleId, number>;
  const trueTop3 = new Set(trueOrder.slice(0, 3));
  for (const ranking of rankings) {
    top1[ranking.rule] = ranking.order[0] === trueOrder[0];
    top3Overlap[ranking.rule] = ranking.order.slice(0, 3).filter((p) => trueTop3.has(p)).length;
  }

  return { trueOrder, rankings, loadSpread: loadSpread(loads), top1, top3Overlap };
}

export type ReplaySummary = {
  trials: number;
  perRule: {
    rule: RuleId;
    label: string;
    /** share of trials where the truly best project ranked first */
    top1Accuracy: number;
    /** average share of the true top 3 recovered in the top 3 */
    top3Recall: number;
  }[];
};

/** Repeat the simulation across seeds and summarise per aggregation rule. */
export function replayTrials(config: ReplayConfig & { trials?: number }): ReplaySummary {
  const trials = config.trials ?? 50;
  const totals = new Map<RuleId, { label: string; top1: number; top3: number }>();

  for (let t = 0; t < trials; t += 1) {
    const outcome = simulateEvent({ ...config, seed: (config.seed ?? 1) + t * 7919 });
    for (const ranking of outcome.rankings) {
      const bucket = totals.get(ranking.rule) ?? { label: ranking.label, top1: 0, top3: 0 };
      bucket.top1 += outcome.top1[ranking.rule] ? 1 : 0;
      bucket.top3 += outcome.top3Overlap[ranking.rule] / 3;
      totals.set(ranking.rule, bucket);
    }
  }

  return {
    trials,
    perRule: [...totals.entries()]
      .map(([rule, bucket]) => ({
        rule,
        label: bucket.label,
        top1Accuracy: bucket.top1 / trials,
        top3Recall: bucket.top3 / trials,
      }))
      .sort((a, b) => b.top1Accuracy - a.top1Accuracy || a.rule.localeCompare(b.rule)),
  };
}

/**
 * Does spending the extra reviews where the certificate points beat spreading
 * them evenly? Same review budget on both sides.
 */
export function compareAllocation(
  config: ReplayConfig & { trials?: number; extraReviews: number },
): {
  trials: number;
  extraReviews: number;
  uniform: { top1Accuracy: number; top3Recall: number };
  targeted: { top1Accuracy: number; top3Recall: number };
} {
  const trials = config.trials ?? 50;
  const rule: RuleId = "calibrated";
  const tally = { uniform: { top1: 0, top3: 0 }, targeted: { top1: 0, top3: 0 } };

  for (let t = 0; t < trials; t += 1) {
    const seed = (config.seed ?? 1) + t * 7919;
    // Both sides spend exactly config.extraReviews extra reviews.
    const uniform = simulateEvent({ ...config, seed, extraMode: "uniform" });
    const targeted = simulateEvent({ ...config, seed, extraMode: "targeted" });

    tally.uniform.top1 += uniform.top1[rule] ? 1 : 0;
    tally.uniform.top3 += uniform.top3Overlap[rule] / 3;
    tally.targeted.top1 += targeted.top1[rule] ? 1 : 0;
    tally.targeted.top3 += targeted.top3Overlap[rule] / 3;
  }

  return {
    trials,
    extraReviews: config.extraReviews,
    uniform: { top1Accuracy: tally.uniform.top1 / trials, top3Recall: tally.uniform.top3 / trials },
    targeted: {
      top1Accuracy: tally.targeted.top1 / trials,
      top3Recall: tally.targeted.top3 / trials,
    },
  };
}
