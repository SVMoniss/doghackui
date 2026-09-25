/**
 * Decision certification.
 *
 * Every judging tool answers "what is the ranking?". This module answers the
 * question nobody asks: *is this ranking safe to act on?*
 *
 * We recompute the outcome under four aggregation rules, bootstrap a confidence
 * interval for every project, and report each prize position as ROBUST (all
 * rules agree) or FRAGILE (they do not) — plus which extra reviews would most
 * reduce the fragility.
 */

import { aggregateAll, reviewTotals, RULE_LABELS, type RuleId, type RuleRanking } from "./aggregate";
import type { Criterion, Review } from "./normalize";
import { normalizeScores } from "./normalize";
import { mulberry32 } from "./random";

export type Verdict = "ROBUST" | "FRAGILE";

export type PositionVerdict = {
  /** 1-based prize position */
  position: number;
  verdict: Verdict;
  /** the project each rule puts in this position */
  byRule: { rule: RuleId; label: string; submissionId: string | null }[];
  /** distinct contenders for this position, most-supported first */
  contenders: { submissionId: string; rules: RuleId[] }[];
  /** the consensus pick: whichever project the most rules place here */
  consensus: string | null;
};

export type ProjectCertificate = {
  submissionId: string;
  reviewCount: number;
  underReviewed: boolean;
  /** rank under each rule */
  ranksByRule: Record<RuleId, number>;
  bestRank: number;
  worstRank: number;
  meanRank: number;
  /** how far the rules disagree about this project */
  rankSpread: number;
  calibratedScore: number;
  /** seeded bootstrap over this project's own reviews */
  interval: { low: number; median: number; high: number };
};

export type ReviewSuggestion = {
  submissionId: string;
  /** higher = reviewing this project next changes the outcome more */
  priority: number;
  reasons: string[];
};

export type DecisionCertificate = {
  overall: Verdict;
  /** how many of the prize positions every rule agrees on */
  agreement: { agreedPositions: number; totalPositions: number };
  rules: RuleRanking[];
  positions: PositionVerdict[];
  projects: ProjectCertificate[];
  suggestions: ReviewSuggestion[];
  /** rules that disagree with the consensus somewhere in the prize range */
  disagreeingRules: RuleId[];
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const percentile = (sorted: number[], p: number) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index]!;
};

export function certifyDecision(params: {
  criteria: Criterion[];
  reviews: Review[];
  submissionIds: string[];
  /** how many places actually matter (prizes). Defaults to 3. */
  prizePositions?: number;
  /** reviews required before a project counts as fully judged */
  minReviews?: number;
  bootstrapSamples?: number;
  seed?: number;
}): DecisionCertificate {
  const ids = params.submissionIds.slice().sort((a, b) => a.localeCompare(b));
  const prizePositions = Math.max(1, Math.min(params.prizePositions ?? 3, ids.length || 1));
  const minReviews = params.minReviews ?? 1;
  const samples = params.bootstrapSamples ?? 400;

  const rules = aggregateAll({
    criteria: params.criteria,
    reviews: params.reviews,
    submissionIds: ids,
  });

  // ---- per prize position, do the rules agree? ----
  const positions: PositionVerdict[] = [];
  const disagreeing = new Set<RuleId>();

  for (let position = 1; position <= prizePositions; position += 1) {
    const byRule = rules.map((r) => ({
      rule: r.rule,
      label: r.label,
      submissionId: r.order[position - 1] ?? null,
    }));
    const tally = new Map<string, RuleId[]>();
    for (const entry of byRule) {
      if (!entry.submissionId) continue;
      const list = tally.get(entry.submissionId) ?? [];
      list.push(entry.rule);
      tally.set(entry.submissionId, list);
    }
    const contenders = [...tally.entries()]
      .map(([submissionId, ruleIds]) => ({ submissionId, rules: ruleIds }))
      .sort((a, b) => b.rules.length - a.rules.length || a.submissionId.localeCompare(b.submissionId));
    const consensus = contenders[0]?.submissionId ?? null;
    const verdict: Verdict = contenders.length <= 1 ? "ROBUST" : "FRAGILE";
    if (verdict === "FRAGILE") {
      for (const contender of contenders.slice(1)) {
        for (const rule of contender.rules) disagreeing.add(rule);
      }
    }
    positions.push({ position, verdict, byRule, contenders, consensus });
  }

  // ---- per project: rank spread across rules + bootstrap interval ----
  const totals = reviewTotals(params.reviews, params.criteria);
  const calibrated = normalizeScores({
    criteria: params.criteria,
    reviews: params.reviews,
    submissionIds: ids,
    minReviews,
  });
  const calibratedById = new Map(calibrated.rows.map((r) => [r.submissionId, r]));

  const projects: ProjectCertificate[] = ids.map((submissionId) => {
    const own = totals.filter((t) => t.submissionId === submissionId).map((t) => t.total);
    const ranksByRule = Object.fromEntries(
      rules.map((r) => [r.rule, r.ranks[submissionId] ?? ids.length]),
    ) as Record<RuleId, number>;
    const rankValues = Object.values(ranksByRule);

    // Resample this project's own reviews to see how much its score depends on
    // which judges it happened to draw.
    const rand = mulberry32((params.seed ?? 42) + hash(submissionId));
    const draws: number[] = [];
    if (own.length > 0) {
      for (let s = 0; s < samples; s += 1) {
        let sum = 0;
        for (let i = 0; i < own.length; i += 1) sum += own[Math.floor(rand() * own.length)]!;
        draws.push(sum / own.length);
      }
      draws.sort((a, b) => a - b);
    }

    return {
      submissionId,
      reviewCount: own.length,
      underReviewed: own.length < minReviews,
      ranksByRule,
      bestRank: Math.min(...rankValues),
      worstRank: Math.max(...rankValues),
      meanRank: mean(rankValues),
      rankSpread: Math.max(...rankValues) - Math.min(...rankValues),
      calibratedScore: calibratedById.get(submissionId)?.normalizedScore ?? 0,
      interval: {
        low: percentile(draws, 0.05),
        median: percentile(draws, 0.5),
        high: percentile(draws, 0.95),
      },
    };
  });

  projects.sort((a, b) => a.meanRank - b.meanRank || a.submissionId.localeCompare(b.submissionId));

  const agreedPositions = positions.filter((p) => p.verdict === "ROBUST").length;

  return {
    overall: agreedPositions === positions.length ? "ROBUST" : "FRAGILE",
    agreement: { agreedPositions, totalPositions: positions.length },
    rules,
    positions,
    projects,
    suggestions: reviewPriority({ projects, positions, prizePositions, minReviews }),
    disagreeingRules: [...disagreeing].sort(),
  };
}

/**
 * Which project deserves the next judge-hour?
 *
 * Uniform review allocation spends effort where the outcome is already settled.
 * We score each project by how much an extra review would change the decision:
 * disputed prize positions first, then wide confidence intervals, then rule
 * disagreement, then a missing review.
 */
export function reviewPriority(params: {
  projects: ProjectCertificate[];
  positions: PositionVerdict[];
  prizePositions: number;
  minReviews: number;
}): ReviewSuggestion[] {
  const contested = new Map<string, number[]>();
  for (const position of params.positions) {
    if (position.verdict !== "FRAGILE") continue;
    for (const contender of position.contenders) {
      const list = contested.get(contender.submissionId) ?? [];
      list.push(position.position);
      contested.set(contender.submissionId, list);
    }
  }

  const suggestions = params.projects.map((project) => {
    const reasons: string[] = [];
    let priority = 0;

    const contestedAt = contested.get(project.submissionId);
    if (contestedAt && contestedAt.length > 0) {
      // Disputes over 1st place matter more than disputes over 5th.
      priority += contestedAt.reduce((acc, position) => acc + 10 / position, 0);
      reasons.push(
        `contested for ${contestedAt.map((p) => ordinal(p)).join(" and ")} place`,
      );
    }

    const width = project.interval.high - project.interval.low;
    if (width > 0) {
      priority += width;
      reasons.push(`score could shift by ±${(width / 2).toFixed(1)} depending on judges drawn`);
    }

    if (project.rankSpread > 0) {
      priority += project.rankSpread * 0.5;
      reasons.push(`ranks ${project.bestRank}–${project.worstRank} depending on the rule used`);
    }

    if (project.underReviewed) {
      priority += 6;
      reasons.push(`only ${project.reviewCount} of ${params.minReviews} reviews`);
    }

    // A project sitting just outside the prize range can still overturn it.
    if (project.bestRank <= params.prizePositions + 1) priority += 2;

    return { submissionId: project.submissionId, priority, reasons };
  });

  return suggestions
    .filter((s) => s.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.submissionId.localeCompare(b.submissionId));
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { RULE_LABELS };
