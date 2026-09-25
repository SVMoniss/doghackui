import { describe, expect, it } from "vitest";

import { normalizeScores, weightedTotal, type Criterion, type Review } from "./normalize";

const criteria: Criterion[] = [
  { id: "c1", name: "Impact", weight: 1, minScore: 1, maxScore: 10 },
  { id: "c2", name: "Innovation", weight: 1, minScore: 1, maxScore: 10 },
];

const review = (judgeId: string, submissionId: string, c1: number, c2: number): Review => ({
  judgeId,
  submissionId,
  scores: { c1, c2 },
});

describe("weightedTotal", () => {
  it("applies criterion weights", () => {
    const weighted: Criterion[] = [
      { id: "c1", weight: 3 },
      { id: "c2", weight: 1 },
    ];
    expect(weightedTotal(review("j", "s", 8, 4), weighted)).toBe(7);
  });

  it("ignores criteria the judge left blank", () => {
    expect(weightedTotal({ judgeId: "j", submissionId: "s", scores: { c1: 6 } }, criteria)).toBe(6);
  });
});

describe("normalizeScores", () => {
  it("corrects for a harsh judge and a lenient judge", () => {
    // Both judges rank the same way; harsh scores everything 3 lower.
    const reviews = [
      review("harsh", "s1", 4, 4),
      review("harsh", "s2", 6, 6),
      review("harsh", "s3", 2, 2),
      review("lenient", "s1", 7, 7),
      review("lenient", "s2", 9, 9),
      review("lenient", "s3", 5, 5),
    ];
    const { rows } = normalizeScores({ criteria, reviews });
    const byId = new Map(rows.map((r) => [r.submissionId, r]));

    expect(byId.get("s2")!.normalizedRank).toBe(1);
    expect(byId.get("s1")!.normalizedRank).toBe(2);
    expect(byId.get("s3")!.normalizedRank).toBe(3);

    // Same submission seen by both judges should land on a similar
    // normalized value even though the raw values differ by 3 points.
    const s1 = byId.get("s1")!;
    const [a, b] = s1.reviews;
    expect(Math.abs(a!.normalizedTotal - b!.normalizedTotal)).toBeLessThan(0.001);
  });

  it("lifts a submission that only harsh judges happened to see", () => {
    const reviews = [
      review("harsh", "unlucky", 6, 6),
      review("harsh", "other", 4, 4),
      review("lenient", "lucky", 8, 8),
      review("lenient", "other", 6, 6),
    ];
    const { rows } = normalizeScores({ criteria, reviews });
    const unlucky = rows.find((r) => r.submissionId === "unlucky")!;
    expect(unlucky.normalizedScore).toBeGreaterThan(unlucky.rawScore);
  });

  it("reports judge bias", () => {
    const reviews = [
      review("harsh", "s1", 2, 2),
      review("harsh", "s2", 3, 3),
      review("lenient", "s1", 9, 9),
      review("lenient", "s2", 10, 10),
    ];
    const { judgeStats } = normalizeScores({ criteria, reviews });
    const harsh = judgeStats.find((s) => s.judgeId === "harsh")!;
    const lenient = judgeStats.find((s) => s.judgeId === "lenient")!;
    expect(harsh.bias).toBeLessThan(0);
    expect(lenient.bias).toBeGreaterThan(0);
  });

  it("flags submissions below the review threshold", () => {
    const reviews = [review("j1", "s1", 8, 8), review("j2", "s1", 7, 7), review("j1", "s2", 6, 6)];
    const { rows } = normalizeScores({ criteria, reviews, minReviews: 2 });
    expect(rows.find((r) => r.submissionId === "s1")!.underReviewed).toBe(false);
    expect(rows.find((r) => r.submissionId === "s2")!.underReviewed).toBe(true);
  });

  it("keeps normalized values inside the score scale", () => {
    const reviews = [
      review("j1", "s1", 10, 10),
      review("j1", "s2", 1, 1),
      review("j2", "s1", 5, 5),
      review("j2", "s2", 5, 5),
    ];
    const { rows } = normalizeScores({ criteria, reviews });
    for (const row of rows) {
      for (const r of row.reviews) {
        expect(r.normalizedTotal).toBeGreaterThanOrEqual(1);
        expect(r.normalizedTotal).toBeLessThanOrEqual(10);
      }
    }
  });

  it("includes submissions with no reviews yet", () => {
    const { rows } = normalizeScores({
      criteria,
      reviews: [review("j1", "s1", 5, 5)],
      submissionIds: ["s1", "s2"],
      minReviews: 1,
    });
    const s2 = rows.find((r) => r.submissionId === "s2")!;
    expect(s2.reviewCount).toBe(0);
    expect(s2.underReviewed).toBe(true);
  });
});
