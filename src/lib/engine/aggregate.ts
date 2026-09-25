/**
 * Four ways to turn the same reviews into a ranking.
 *
 * A leaderboard is only as trustworthy as its aggregation rule, and different
 * rules can crown different winners from identical data. Rather than picking one
 * and hoping, we compute all four so the decision can be certified against them
 * (see robustness.ts).
 */

import { normalizeScores, weightedTotal, type Criterion, type Review } from "./normalize";

export type RuleId = "rawAverage" | "calibrated" | "bradleyTerry" | "borda";

export const RULE_LABELS: Record<RuleId, string> = {
  rawAverage: "Raw average",
  calibrated: "Judge-calibrated average",
  bradleyTerry: "Pairwise (Bradley-Terry)",
  borda: "Rank-based (Borda)",
};

export type RuleRanking = {
  rule: RuleId;
  label: string;
  /** submissionId -> rule score (higher is better; scales differ between rules) */
  scores: Record<string, number>;
  /** best first; ties broken by submissionId so the order is deterministic */
  order: string[];
  /** submissionId -> 1-based rank */
  ranks: Record<string, number>;
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function toRanking(rule: RuleId, scores: Record<string, number>, ids: string[]): RuleRanking {
  const full: Record<string, number> = {};
  for (const id of ids) full[id] = scores[id] ?? 0;
  const order = ids
    .slice()
    .sort((a, b) => (full[b] ?? 0) - (full[a] ?? 0) || a.localeCompare(b));
  const ranks: Record<string, number> = {};
  order.forEach((id, index) => {
    ranks[id] = index + 1;
  });
  return { rule, label: RULE_LABELS[rule], scores: full, order, ranks };
}

/** Weighted rubric total per review, grouped by submission. */
export function reviewTotals(reviews: Review[], criteria: Criterion[]) {
  return reviews.map((review) => ({
    judgeId: review.judgeId,
    submissionId: review.submissionId,
    total: weightedTotal(review, criteria),
  }));
}

export function rankRawAverage(
  reviews: Review[],
  criteria: Criterion[],
  ids: string[],
): RuleRanking {
  const totals = reviewTotals(reviews, criteria);
  const scores: Record<string, number> = {};
  for (const id of ids) {
    scores[id] = mean(totals.filter((t) => t.submissionId === id).map((t) => t.total));
  }
  return toRanking("rawAverage", scores, ids);
}

export function rankCalibrated(
  reviews: Review[],
  criteria: Criterion[],
  ids: string[],
): RuleRanking {
  const result = normalizeScores({ criteria, reviews, submissionIds: ids });
  const scores: Record<string, number> = {};
  for (const row of result.rows) scores[row.submissionId] = row.normalizedScore;
  return toRanking("calibrated", scores, ids);
}

/**
 * Borda-style: within each judge's own set of reviews, rank the submissions they
 * saw, then average the normalised rank positions. Immune to how generous a
 * judge's absolute numbers are, because only their ordering is used.
 */
export function rankBorda(reviews: Review[], criteria: Criterion[], ids: string[]): RuleRanking {
  const totals = reviewTotals(reviews, criteria);
  const byJudge = new Map<string, { submissionId: string; total: number }[]>();
  for (const t of totals) {
    const list = byJudge.get(t.judgeId) ?? [];
    list.push({ submissionId: t.submissionId, total: t.total });
    byJudge.set(t.judgeId, list);
  }

  const points = new Map<string, number[]>();
  for (const list of [...byJudge.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1])) {
    if (list.length === 0) continue;
    const ordered = list
      .slice()
      .sort((a, b) => b.total - a.total || a.submissionId.localeCompare(b.submissionId));
    ordered.forEach((entry, index) => {
      // 1 for this judge's favourite, 0 for their last, 0.5 when they only saw one.
      const share = ordered.length === 1 ? 0.5 : 1 - index / (ordered.length - 1);
      const bucket = points.get(entry.submissionId) ?? [];
      bucket.push(share);
      points.set(entry.submissionId, bucket);
    });
  }

  const scores: Record<string, number> = {};
  for (const id of ids) scores[id] = mean(points.get(id) ?? []);
  return toRanking("borda", scores, ids);
}

export type PairwiseCount = { winner: string; loser: string; weight: number };

/**
 * Induce pairwise preferences from rubric scores: within one judge's reviews,
 * the higher weighted total beats the lower, a tie splits the win.
 */
export function inducePairs(reviews: Review[], criteria: Criterion[]): PairwiseCount[] {
  const totals = reviewTotals(reviews, criteria);
  const byJudge = new Map<string, { submissionId: string; total: number }[]>();
  for (const t of totals) {
    const list = byJudge.get(t.judgeId) ?? [];
    list.push({ submissionId: t.submissionId, total: t.total });
    byJudge.set(t.judgeId, list);
  }

  const pairs: PairwiseCount[] = [];
  for (const judgeId of [...byJudge.keys()].sort()) {
    const list = (byJudge.get(judgeId) ?? [])
      .slice()
      .sort((a, b) => a.submissionId.localeCompare(b.submissionId));
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.submissionId === b.submissionId) continue;
        if (a.total === b.total) {
          pairs.push({ winner: a.submissionId, loser: b.submissionId, weight: 0.5 });
          pairs.push({ winner: b.submissionId, loser: a.submissionId, weight: 0.5 });
        } else if (a.total > b.total) {
          pairs.push({ winner: a.submissionId, loser: b.submissionId, weight: 1 });
        } else {
          pairs.push({ winner: b.submissionId, loser: a.submissionId, weight: 1 });
        }
      }
    }
  }
  return pairs;
}

/**
 * Bradley-Terry strengths via the standard MM (minorisation-maximisation)
 * iteration, with a small uniform prior so unbeaten or unbeatable entries stay
 * finite. Deterministic: fixed iteration count, no randomness.
 */
export function fitBradleyTerry(
  pairs: PairwiseCount[],
  ids: string[],
  options?: { iterations?: number; prior?: number },
): Record<string, number> {
  const iterations = options?.iterations ?? 200;
  const prior = options?.prior ?? 0.5;
  const strength: Record<string, number> = {};
  for (const id of ids) strength[id] = 1;
  if (ids.length < 2) return strength;

  const wins: Record<string, number> = {};
  const meetings = new Map<string, number>();
  for (const id of ids) wins[id] = prior;
  const bump = (a: string, b: string, w: number) => {
    const k = a < b ? `${a}::${b}` : `${b}::${a}`;
    meetings.set(k, (meetings.get(k) ?? 0) + w);
  };
  for (const pair of pairs) {
    if (!(pair.winner in strength) || !(pair.loser in strength)) continue;
    wins[pair.winner] = (wins[pair.winner] ?? 0) + pair.weight;
    bump(pair.winner, pair.loser, pair.weight);
  }
  // The prior acts as a phantom draw against every other entry.
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      bump(ids[i]!, ids[j]!, (2 * prior) / (ids.length - 1));
    }
  }

  for (let step = 0; step < iterations; step += 1) {
    const next: Record<string, number> = {};
    for (const id of ids) {
      let denom = 0;
      for (const other of ids) {
        if (other === id) continue;
        const k = id < other ? `${id}::${other}` : `${other}::${id}`;
        const n = meetings.get(k) ?? 0;
        if (n === 0) continue;
        denom += n / (strength[id]! + strength[other]!);
      }
      next[id] = denom > 0 ? (wins[id] ?? 0) / denom : strength[id]!;
    }
    const geo = Math.exp(
      mean(ids.map((id) => Math.log(Math.max(next[id] ?? 1e-9, 1e-9)))),
    );
    for (const id of ids) strength[id] = (next[id] ?? 1) / (geo || 1);
  }

  return strength;
}

export function rankBradleyTerry(
  reviews: Review[],
  criteria: Criterion[],
  ids: string[],
): RuleRanking {
  const strengths = fitBradleyTerry(inducePairs(reviews, criteria), ids);
  return toRanking("bradleyTerry", strengths, ids);
}

/** All four rules over the same data. */
export function aggregateAll(params: {
  criteria: Criterion[];
  reviews: Review[];
  submissionIds: string[];
}): RuleRanking[] {
  const ids = params.submissionIds.slice().sort((a, b) => a.localeCompare(b));
  return [
    rankRawAverage(params.reviews, params.criteria, ids),
    rankCalibrated(params.reviews, params.criteria, ids),
    rankBradleyTerry(params.reviews, params.criteria, ids),
    rankBorda(params.reviews, params.criteria, ids),
  ];
}
