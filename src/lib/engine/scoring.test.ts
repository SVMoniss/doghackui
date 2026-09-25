import { describe, expect, it } from "vitest";

import {
  CRITERION_IDS,
  WEIGHTS,
  assessmentsToReviews,
  calculateJudgeProjectScore,
  normalizedScore,
  rubricCriteria,
  validateAssessment,
} from "./scoring";
import { weightedTotal } from "./normalize";

describe("fixed rubric weights", () => {
  it("declares five criteria whose weights sum to exactly 1", () => {
    expect(CRITERION_IDS).toHaveLength(5);
    const sum = CRITERION_IDS.reduce((total, id) => total + WEIGHTS[id]!, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("uses the published weights", () => {
    expect(WEIGHTS).toEqual({
      impact: 0.25,
      innovation: 0.2,
      technical_execution: 0.3,
      design: 0.15,
      presentation_evidence: 0.1,
    });
  });
});

describe("normalizedScore", () => {
  it("maps 1 to 0 and 10 to 1", () => {
    expect(normalizedScore(1)).toBe(0);
    expect(normalizedScore(10)).toBe(1);
  });

  it("is linear in between", () => {
    expect(normalizedScore(5.5)).toBeCloseTo(0.5, 10);
  });
});

describe("calculateJudgeProjectScore", () => {
  it("returns 1 when every criterion scores 1, and 10 when all score 10", () => {
    const min = {
      impact: 1,
      innovation: 1,
      technical_execution: 1,
      design: 1,
      presentation_evidence: 1,
    } as const;
    const max = {
      impact: 10,
      innovation: 10,
      technical_execution: 10,
      design: 10,
      presentation_evidence: 10,
    } as const;
    expect(calculateJudgeProjectScore({ ...min })).toBeCloseTo(1, 10);
    expect(calculateJudgeProjectScore({ ...max })).toBeCloseTo(10, 10);
  });

  it("weights technical execution at 30%: a perfect execution-only project scores 3.7", () => {
    // q = 0.30 * 1 + 0.70 * 0 = 0.30 -> Q = 1 + 9 * 0.30 = 3.7
    const scores = {
      impact: 1,
      innovation: 1,
      technical_execution: 10,
      design: 1,
      presentation_evidence: 1,
    };
    expect(calculateJudgeProjectScore(scores)).toBeCloseTo(3.7, 10);
  });

  it("matches weightedTotal over rubricCriteria so the ranking rules consume the same input", () => {
    const scores = {
      impact: 8,
      innovation: 6,
      technical_execution: 9,
      design: 7,
      presentation_evidence: 5,
    };
    const [review] = assessmentsToReviews([{ judgeKey: "j1", submissionId: "p1", scores }]);
    expect(weightedTotal(review!, rubricCriteria())).toBeCloseTo(
      calculateJudgeProjectScore(scores),
      10,
    );
  });
});

describe("validateAssessment", () => {
  const valid = {
    criterion: "impact",
    score: 8,
    confidence: 4,
    rationale: "Clear beneficiary and a measurable outcome.",
    evidenceRefs: [],
    acknowledgedFlags: [],
  };

  it("accepts a well-formed assessment", () => {
    expect(validateAssessment(valid)).toEqual([]);
  });

  it("rejects unknown criteria, out-of-range scores, and missing rationale", () => {
    expect(validateAssessment({ ...valid, criterion: "vibes" }).length).toBeGreaterThan(0);
    expect(validateAssessment({ ...valid, score: 0 }).length).toBeGreaterThan(0);
    expect(validateAssessment({ ...valid, score: 7.5 }).length).toBeGreaterThan(0);
    expect(validateAssessment({ ...valid, score: 11 }).length).toBeGreaterThan(0);
    expect(validateAssessment({ ...valid, confidence: 6 }).length).toBeGreaterThan(0);
    expect(validateAssessment({ ...valid, rationale: "  " }).length).toBeGreaterThan(0);
  });
});
