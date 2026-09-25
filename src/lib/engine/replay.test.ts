import { describe, expect, it } from "vitest";

import { compareAllocation, replayTrials, simulateEvent } from "./replay";

describe("replay harness", () => {
  it("is deterministic for a given seed", () => {
    const config = { projectCount: 12, judgeCount: 5, reviewsPerProject: 3, seed: 5 };
    expect(JSON.stringify(simulateEvent(config))).toBe(JSON.stringify(simulateEvent(config)));
  });

  it("keeps judge workloads balanced in the simulated event", () => {
    const outcome = simulateEvent({
      projectCount: 12,
      judgeCount: 5,
      reviewsPerProject: 3,
      seed: 11,
    });
    expect(outcome.loadSpread).toBeLessThanOrEqual(1);
    expect(outcome.trueOrder).toHaveLength(12);
  });

  it("reproduces the failure we exist to fix: noise decides the podium", () => {
    // Harsh/lenient judges plus compressed scoring is the documented real-world
    // pattern. A raw average should visibly fail to recover the true winner.
    const summary = replayTrials({
      projectCount: 16,
      judgeCount: 6,
      reviewsPerProject: 3,
      harshnessSpread: 2.5,
      noise: 1.8,
      compression: 0.7,
      trials: 40,
      seed: 3,
    });

    const raw = summary.perRule.find((r) => r.rule === "rawAverage")!;
    expect(raw.top1Accuracy).toBeLessThan(0.9);
    // Every rule should still beat picking at random from 16 projects.
    for (const rule of summary.perRule) {
      expect(rule.top1Accuracy).toBeGreaterThan(1 / 16);
      expect(rule.top3Recall).toBeGreaterThan(1 / 16);
    }
  });

  it("reports every rule, sorted by how often it finds the best project", () => {
    const summary = replayTrials({
      projectCount: 10,
      judgeCount: 4,
      reviewsPerProject: 3,
      trials: 20,
      seed: 2,
    });
    expect(summary.trials).toBe(20);
    expect(summary.perRule).toHaveLength(4);
    const accuracies = summary.perRule.map((r) => r.top1Accuracy);
    expect(accuracies).toEqual([...accuracies].sort((a, b) => b - a));
  });

  it(
    "spending the same extra reviews where the certificate points finds the winner more often",
    () => {
      const result = compareAllocation({
        projectCount: 24,
        judgeCount: 8,
        reviewsPerProject: 3,
        harshnessSpread: 2.5,
        noise: 1.8,
        compression: 0.7,
        extraReviews: 12,
        prizePositions: 3,
        trials: 60,
        seed: 3,
      });
      expect(result.trials).toBe(60);
      expect(result.extraReviews).toBe(12);
      expect(result.targeted.top1Accuracy).toBeGreaterThan(result.uniform.top1Accuracy);
    },
    // Monte-Carlo over 60 trials; generous budget for loaded CI laptops.
    60000,
  );
});
