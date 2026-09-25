import { describe, expect, it } from "vitest";

import { loadSpread, planAssignments } from "./assignment";
import { normalizeScores, type Review } from "./normalize";

/**
 * End-to-end acceptance for the judging pipeline: 12 projects and 5 judges go
 * through assignment, scoring with biased judges, and ranking.
 */
describe("acceptance: assignment through results", () => {
  const submissions = Array.from({ length: 12 }, (_, i) => ({
    id: `11111111-1111-1111-1111-0000000000${String(i).padStart(2, "0")}`,
    trackId: null,
    ownerId: i === 0 ? "owner-a" : null,
  }));
  const judges = Array.from({ length: 5 }, (_, i) => ({
    id: `22222222-2222-2222-2222-0000000000${String(i).padStart(2, "0")}`,
    userId: i === 0 ? "owner-a" : null,
    active: true,
  }));
  const criteria = ["Impact", "Innovation", "Technical Execution", "Design", "Presentation"].map(
    (name, i) => ({
      id: `criterion-${i}`,
      name,
      weight: 1,
      minScore: 1,
      maxScore: 10,
    }),
  );

  const plan = planAssignments({
    submissions,
    judges,
    reviewsPerSubmission: 3,
    existing: [],
    conflicts: [{ judgeId: judges[1]!.id, submissionId: submissions[1]!.id }],
  });

  it("gives every project the requested number of reviews", () => {
    expect(plan.shortfalls).toEqual([]);
    for (const submission of submissions) {
      const count = plan.created.filter((pair) => pair.submissionId === submission.id).length;
      expect(count).toBe(3);
    }
  });

  it("keeps judge workloads balanced", () => {
    expect(loadSpread(plan.loads)).toBeLessThanOrEqual(1);
  });

  it("never assigns a judge their own team or a conflict", () => {
    expect(
      plan.created.some(
        (pair) => pair.judgeId === judges[0]!.id && pair.submissionId === submissions[0]!.id,
      ),
    ).toBe(false);
    expect(
      plan.created.some(
        (pair) => pair.judgeId === judges[1]!.id && pair.submissionId === submissions[1]!.id,
      ),
    ).toBe(false);
  });

  it("re-running adds nothing once coverage is complete", () => {
    const rerun = planAssignments({
      submissions,
      judges,
      reviewsPerSubmission: 3,
      existing: plan.created,
      conflicts: [],
    });
    expect(rerun.created).toEqual([]);
  });

  it("normalization corrects judge harshness and reports both ranks", () => {
    // Judge 0 is harsh (-2), judge 4 lenient (+2); the underlying quality of a
    // project is its index, so the ideal ranking is by index descending.
    const bias = [-2, -1, 0, 1, 2];
    const reviews: Review[] = plan.created.map((pair) => {
      const judgeIndex = judges.findIndex((j) => j.id === pair.judgeId);
      const quality = submissions.findIndex((s) => s.id === pair.submissionId) / 2 + 3;
      const value = Math.min(10, Math.max(1, quality + bias[judgeIndex]!));
      return {
        judgeId: pair.judgeId,
        submissionId: pair.submissionId,
        scores: Object.fromEntries(criteria.map((c) => [c.id, value])),
      };
    });

    const result = normalizeScores({
      criteria,
      reviews,
      submissionIds: submissions.map((s) => s.id),
      minReviews: 3,
    });

    expect(result.rows).toHaveLength(12);
    expect(result.rows.every((row) => row.underReviewed === false)).toBe(true);
    expect(result.judgeStats).toHaveLength(5);

    // The harsh judge scores below the field mean, the lenient judge above it.
    const harsh = result.judgeStats.find((s) => s.judgeId === judges[0]!.id)!;
    const lenient = result.judgeStats.find((s) => s.judgeId === judges[4]!.id)!;
    expect(harsh.bias).toBeLessThan(0);
    expect(lenient.bias).toBeGreaterThan(0);

    // Every project keeps a raw rank and a normalized rank.
    const ranks = result.rows.map((row) => row.normalizedRank).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    expect(result.rows.every((row) => row.rawRank >= 1 && row.rawRank <= 12)).toBe(true);
  });

  it("flags projects that fall below the review threshold", () => {
    const reviews: Review[] = [
      {
        judgeId: judges[0]!.id,
        submissionId: submissions[0]!.id,
        scores: Object.fromEntries(criteria.map((c) => [c.id, 8])),
      },
    ];
    const result = normalizeScores({
      criteria,
      reviews,
      submissionIds: [submissions[0]!.id],
      minReviews: 3,
    });
    expect(result.rows[0]!.underReviewed).toBe(true);
  });
});
