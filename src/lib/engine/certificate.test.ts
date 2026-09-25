import { describe, expect, it } from "vitest";

import { buildEvidenceCertificate } from "./certificate";
import { rubricCriteria, assessmentsToReviews } from "./scoring";

const reviews = assessmentsToReviews([
  { judgeKey: "j1", submissionId: "a", scores: { impact: 10, innovation: 10, technical_execution: 10, design: 10, presentation_evidence: 10 } },
  { judgeKey: "j2", submissionId: "a", scores: { impact: 10, innovation: 10, technical_execution: 10, design: 10, presentation_evidence: 10 } },
  { judgeKey: "j1", submissionId: "b", scores: { impact: 6, innovation: 6, technical_execution: 6, design: 6, presentation_evidence: 6 } },
  { judgeKey: "j2", submissionId: "b", scores: { impact: 6, innovation: 6, technical_execution: 6, design: 6, presentation_evidence: 6 } },
  { judgeKey: "j1", submissionId: "c", scores: { impact: 2, innovation: 2, technical_execution: 2, design: 2, presentation_evidence: 2 } },
  { judgeKey: "j2", submissionId: "c", scores: { impact: 2, innovation: 2, technical_execution: 2, design: 2, presentation_evidence: 2 } },
]);

const evidence = {
  sufficiency: 0.8,
  signal: "SUFFICIENT" as const,
  verifiedClaims: 3,
  partialClaims: 1,
  contradictedClaims: 0,
};

describe("buildEvidenceCertificate", () => {
  it("returns ROBUST when all four rules agree on the project's rank", () => {
    const cert = buildEvidenceCertificate({
      criteria: rubricCriteria(),
      reviews,
      submissionIds: ["a", "b", "c"],
      projectId: "a",
      prizePositions: 1,
      eligibility: "ELIGIBLE",
      evidence,
    });
    expect(cert.prizeBoundary.verdict).toBe("ROBUST");
    expect(cert.prizeBoundary.disagreeingMethods).toEqual([]);
    expect(cert.methods.rawAverage.rank).toBe(1);
    expect(cert.methods.borda.rank).toBe(1);
    expect(cert.scoreVersion).toBe("rubric-v1");
    expect(cert.prizeBoundary.explanation).toContain("ROBUST");
  });

  it("names contenders and disagreeing methods when rules split", () => {
    // a wins big with one judge but loses narrowly to two others: the raw
    // average still crowns a, while calibrated, Bradley-Terry, and Borda
    // all prefer b. Genuine rule disagreement near the boundary.
    const split = assessmentsToReviews([
      { judgeKey: "j1", submissionId: "a", scores: { impact: 10, innovation: 10, technical_execution: 10, design: 10, presentation_evidence: 10 } },
      { judgeKey: "j1", submissionId: "b", scores: { impact: 1, innovation: 1, technical_execution: 1, design: 1, presentation_evidence: 1 } },
      { judgeKey: "j2", submissionId: "a", scores: { impact: 5, innovation: 5, technical_execution: 5, design: 5, presentation_evidence: 5 } },
      { judgeKey: "j2", submissionId: "b", scores: { impact: 6, innovation: 6, technical_execution: 6, design: 6, presentation_evidence: 6 } },
      { judgeKey: "j3", submissionId: "a", scores: { impact: 5, innovation: 5, technical_execution: 5, design: 5, presentation_evidence: 5 } },
      { judgeKey: "j3", submissionId: "b", scores: { impact: 6, innovation: 6, technical_execution: 6, design: 6, presentation_evidence: 6 } },
    ]);
    const cert = buildEvidenceCertificate({
      criteria: rubricCriteria(),
      reviews: split,
      submissionIds: ["a", "b"],
      projectId: "a",
      prizePositions: 1,
      eligibility: "PROVISIONAL",
      evidence: { ...evidence, signal: "REQUESTED_EVIDENCE" },
    });
    expect(cert.prizeBoundary.verdict).toBe("FRAGILE");
    expect(cert.prizeBoundary.contenders).toContain("b");
    expect(cert.prizeBoundary.explanation).toContain("FRAGILE");
    expect(cert.eligibilityStatus).toBe("PROVISIONAL");
  });

  it("keeps eligibility separate from the ranking verdict", () => {
    const cert = buildEvidenceCertificate({
      criteria: rubricCriteria(),
      reviews,
      submissionIds: ["a", "b", "c"],
      projectId: "c",
      prizePositions: 1,
      eligibility: "INELIGIBLE",
      evidence,
    });
    // Ranking maths are untouched by eligibility; eligibility is reported alongside.
    expect(cert.methods.rawAverage.rank).toBe(3);
    expect(cert.eligibilityStatus).toBe("INELIGIBLE");
  });
});
