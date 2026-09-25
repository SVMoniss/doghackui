import { describe, expect, it } from "vitest";

import type { Criterion, Review } from "./normalize";
import { certifyDecision } from "./robustness";
import { nextReviewTargets } from "./targeting";

const criteria: Criterion[] = [{ id: "c1", weight: 1, minScore: 1, maxScore: 10 }];

const review = (judgeId: string, submissionId: string, value: number): Review => ({
  judgeId,
  submissionId,
  scores: { c1: value },
});

describe("certifyDecision", () => {
  it("certifies an unambiguous result as ROBUST", () => {
    const reviews = [
      review("j1", "a", 10),
      review("j2", "a", 10),
      review("j1", "b", 6),
      review("j2", "b", 6),
      review("j1", "c", 2),
      review("j2", "c", 2),
    ];
    const cert = certifyDecision({
      criteria,
      reviews,
      submissionIds: ["a", "b", "c"],
      prizePositions: 3,
      minReviews: 2,
    });

    expect(cert.overall).toBe("ROBUST");
    expect(cert.agreement).toEqual({ agreedPositions: 3, totalPositions: 3 });
    expect(cert.positions[0]!.consensus).toBe("a");
    expect(cert.disagreeingRules).toEqual([]);
  });

  it("flags a podium the rules disagree about as FRAGILE", () => {
    // A rock-paper-scissors panel: no judge saw all three, and each one prefers
    // a different project. Averages crown c, orderings crown a.
    const reviews = [
      review("j1", "a", 10),
      review("j1", "b", 6),
      review("j2", "b", 7),
      review("j2", "c", 6),
      review("j3", "c", 10),
      review("j3", "a", 1),
    ];
    const cert = certifyDecision({
      criteria,
      reviews,
      submissionIds: ["a", "b", "c"],
      prizePositions: 1,
      minReviews: 2,
    });

    expect(cert.overall).toBe("FRAGILE");
    expect(cert.positions[0]!.contenders.length).toBeGreaterThan(1);
    expect(cert.disagreeingRules.length).toBeGreaterThan(0);
    // Both contenders for first place should be named as worth another review.
    expect(cert.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(cert.suggestions[0]!.reasons.join(" ")).toContain("1st place");
  });

  it("reports rank spread and a confidence interval per project", () => {
    const reviews = [review("j1", "a", 10), review("j2", "a", 2), review("j1", "b", 6)];
    const cert = certifyDecision({
      criteria,
      reviews,
      submissionIds: ["a", "b"],
      minReviews: 2,
      seed: 7,
    });

    const a = cert.projects.find((p) => p.submissionId === "a")!;
    expect(a.reviewCount).toBe(2);
    expect(a.interval.high).toBeGreaterThan(a.interval.low);
    expect(a.interval.low).toBeGreaterThanOrEqual(2);
    expect(a.interval.high).toBeLessThanOrEqual(10);

    const b = cert.projects.find((p) => p.submissionId === "b")!;
    expect(b.underReviewed).toBe(true);
    expect(cert.suggestions.find((s) => s.submissionId === "b")!.reasons.join(" ")).toContain(
      "1 of 2 reviews",
    );
  });

  it("is deterministic for the same seed", () => {
    const reviews = [review("j1", "a", 9), review("j2", "a", 4), review("j1", "b", 7)];
    const run = () =>
      certifyDecision({ criteria, reviews, submissionIds: ["a", "b"], seed: 99 });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe("nextReviewTargets", () => {
  const suggestions = [
    { submissionId: "a", priority: 10, reasons: ["contested for 1st place"] },
    { submissionId: "b", priority: 4, reasons: ["wide interval"] },
  ];

  it("sends the next reviews to the highest-priority projects first", () => {
    const targets = nextReviewTargets({
      submissions: [{ id: "a" }, { id: "b" }, { id: "c" }],
      judges: [{ id: "j1" }, { id: "j2" }],
      suggestions,
      maxTargets: 2,
    });
    expect(targets.map((t) => t.submissionId)).toEqual(["a", "b"]);
    expect(targets[0]!.reasons).toContain("contested for 1st place");
  });

  it("never targets a conflicted judge, the owner, or a repeat review", () => {
    const targets = nextReviewTargets({
      submissions: [{ id: "a", ownerId: "user-1" }],
      judges: [
        { id: "j1", userId: "user-1" },
        { id: "j2" },
        { id: "j3" },
      ],
      existing: [{ judgeId: "j2", submissionId: "a" }],
      conflicts: [{ judgeId: "j3", submissionId: "a" }],
      suggestions: [suggestions[0]!],
      maxTargets: 5,
    });
    expect(targets).toEqual([]);
  });

  it("keeps extra workload level across judges", () => {
    const targets = nextReviewTargets({
      submissions: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      judges: [{ id: "j1" }, { id: "j2" }],
      suggestions: ["a", "b", "c", "d"].map((sid, i) => ({
        submissionId: sid,
        priority: 10 - i,
        reasons: [],
      })),
      maxTargets: 4,
      maxExtraPerJudge: 2,
    });
    const perJudge = targets.reduce<Record<string, number>>((acc, t) => {
      acc[t.judgeId] = (acc[t.judgeId] ?? 0) + 1;
      return acc;
    }, {});
    expect(targets).toHaveLength(4);
    expect(Object.values(perJudge)).toEqual([2, 2]);
  });

  it("respects the target budget", () => {
    const targets = nextReviewTargets({
      submissions: [{ id: "a" }, { id: "b" }],
      judges: [{ id: "j1" }, { id: "j2" }],
      suggestions,
      maxTargets: 1,
    });
    expect(targets).toHaveLength(1);
  });
});
