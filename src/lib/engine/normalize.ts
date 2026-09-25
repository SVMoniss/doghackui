/**
 * Score normalization engine.
 *
 * A raw average punishes teams who happened to draw harsh judges. We correct
 * for that by converting each review into a z-score within the judge's own
 * distribution, then mapping it back onto the shared score scale.
 */

export type Criterion = {
  id: string;
  name?: string;
  weight: number;
  minScore?: number;
  maxScore?: number;
};

export type Review = {
  judgeId: string;
  submissionId: string;
  /** criterionId -> raw value */
  scores: Record<string, number>;
};

export type LeaderboardRow = {
  submissionId: string;
  reviewCount: number;
  rawScore: number;
  normalizedScore: number;
  rawRank: number;
  normalizedRank: number;
  /** true when the submission has fewer reviews than the event requires */
  underReviewed: boolean;
  reviews: { judgeId: string; rawTotal: number; normalizedTotal: number }[];
};

export type JudgeStats = {
  judgeId: string;
  reviewCount: number;
  mean: number;
  stdDev: number;
  /** mean minus the overall mean: negative = harsh, positive = lenient */
  bias: number;
};

export type NormalizationResult = {
  rows: LeaderboardRow[];
  judgeStats: JudgeStats[];
  overallMean: number;
  overallStdDev: number;
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const stdDev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Weighted total for one review, expressed on the criteria score scale. */
export function weightedTotal(review: Review, criteria: Criterion[]): number {
  let weightSum = 0;
  let valueSum = 0;
  for (const c of criteria) {
    const value = review.scores[c.id];
    if (value === undefined || value === null || Number.isNaN(value)) continue;
    const weight = c.weight > 0 ? c.weight : 0;
    weightSum += weight;
    valueSum += weight * value;
  }
  return weightSum === 0 ? 0 : valueSum / weightSum;
}

export function normalizeScores(params: {
  criteria: Criterion[];
  reviews: Review[];
  submissionIds?: string[];
  /** minimum reviews before a submission is considered fully judged */
  minReviews?: number;
}): NormalizationResult {
  const { criteria, reviews } = params;
  const minReviews = params.minReviews ?? 1;
  const scaleMin = Math.min(...criteria.map((c) => c.minScore ?? 1), 1);
  const scaleMax = Math.max(...criteria.map((c) => c.maxScore ?? 10), 1);

  const totals = reviews.map((review) => ({
    judgeId: review.judgeId,
    submissionId: review.submissionId,
    rawTotal: weightedTotal(review, criteria),
  }));

  const overallMean = mean(totals.map((t) => t.rawTotal));
  const overallStdDev = stdDev(totals.map((t) => t.rawTotal));

  const byJudge = new Map<string, number[]>();
  for (const t of totals) {
    const list = byJudge.get(t.judgeId) ?? [];
    list.push(t.rawTotal);
    byJudge.set(t.judgeId, list);
  }

  const judgeStats: JudgeStats[] = [...byJudge.entries()]
    .map(([judgeId, values]) => ({
      judgeId,
      reviewCount: values.length,
      mean: mean(values),
      stdDev: stdDev(values),
      bias: mean(values) - overallMean,
    }))
    .sort((a, b) => a.judgeId.localeCompare(b.judgeId));

  const statsById = new Map(judgeStats.map((s) => [s.judgeId, s]));

  const normalizedTotals = totals.map((t) => {
    const stats = statsById.get(t.judgeId)!;
    // A judge who gave the same score to everything carries no usable signal
    // about spread, so only their offset is corrected.
    const z = stats.stdDev > 0 ? (t.rawTotal - stats.mean) / stats.stdDev : 0;
    const scaled = overallStdDev > 0 ? overallMean + z * overallStdDev : t.rawTotal - stats.bias;
    return { ...t, normalizedTotal: clamp(scaled, scaleMin, scaleMax) };
  });

  const ids = new Set(params.submissionIds ?? normalizedTotals.map((t) => t.submissionId));
  const rows: LeaderboardRow[] = [...ids].map((submissionId) => {
    const own = normalizedTotals.filter((t) => t.submissionId === submissionId);
    return {
      submissionId,
      reviewCount: own.length,
      rawScore: mean(own.map((t) => t.rawTotal)),
      normalizedScore: mean(own.map((t) => t.normalizedTotal)),
      rawRank: 0,
      normalizedRank: 0,
      underReviewed: own.length < minReviews,
      reviews: own
        .map((t) => ({
          judgeId: t.judgeId,
          rawTotal: t.rawTotal,
          normalizedTotal: t.normalizedTotal,
        }))
        .sort((a, b) => a.judgeId.localeCompare(b.judgeId)),
    };
  });

  rankBy(rows, "rawScore", "rawRank");
  rankBy(rows, "normalizedScore", "normalizedRank");
  rows.sort((a, b) => a.normalizedRank - b.normalizedRank);

  return { rows, judgeStats, overallMean, overallStdDev };
}

function rankBy(
  rows: LeaderboardRow[],
  scoreKey: "rawScore" | "normalizedScore",
  rankKey: "rawRank" | "normalizedRank",
) {
  const ordered = rows
    .slice()
    .sort((a, b) => b[scoreKey] - a[scoreKey] || a.submissionId.localeCompare(b.submissionId));
  ordered.forEach((row, index) => {
    row[rankKey] = index + 1;
  });
}
