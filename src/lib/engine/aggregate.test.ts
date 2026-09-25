import { describe, expect, it } from "vitest";

import {
  aggregateAll,
  fitBradleyTerry,
  inducePairs,
  rankBorda,
  rankBradleyTerry,
  rankRawAverage,
} from "./aggregate";
import type { Criterion, Review } from "./normalize";

const criteria: Criterion[] = [{ id: "c1", weight: 1, minScore: 1, maxScore: 10 }];

const review = (judgeId: string, submissionId: string, value: number): Review => ({
  judgeId,
  submissionId,
  scores: { c1: value },
});

describe("aggregate", () => {
  it("raw average ranks by plain mean", () => {
    const ranking = rankRawAverage(
      [review("j1", "a", 8), review("j2", "a", 6), review("j1", "b", 5)],
      criteria,
      ["a", "b"],
    );
    expect(ranking.scores['a']).toBe(7);
    expect(ranking.order).toEqual(["a", "b"]);
    expect(ranking.ranks['a']).toBe(1);
  });

  it("borda ignores how generous a judge's absolute numbers are", () => {
    // Both judges rank b above a; the harsh judge just uses lower numbers.
    const reviews = [
      review("harsh", "a", 2),
      review("harsh", "b", 3),
      review("kind", "a", 9),
      review("kind", "b", 10),
    ];
    const ranking = rankBorda(reviews, criteria, ["a", "b"]);
    expect(ranking.order).toEqual(["b", "a"]);
    expect(ranking.scores['b']).toBe(1);
    expect(ranking.scores['a']).toBe(0);
  });

  it("induces pairwise preferences within each judge, splitting ties", () => {
    const pairs = inducePairs([review("j1", "a", 9), review("j1", "b", 4)], criteria);
    expect(pairs).toEqual([{ winner: "a", loser: "b", weight: 1 }]);

    const tied = inducePairs([review("j1", "a", 5), review("j1", "b", 5)], criteria);
    expect(tied).toHaveLength(2);
    expect(tied.every((p) => p.weight === 0.5)).toBe(true);
  });

  it("bradley-terry recovers a transitive chain", () => {
    const reviews = [
      review("j1", "a", 9),
      review("j1", "b", 6),
      review("j2", "b", 7),
      review("j2", "c", 3),
      review("j3", "a", 10),
      review("j3", "c", 4),
    ];
    const ranking = rankBradleyTerry(reviews, criteria, ["a", "b", "c"]);
    expect(ranking.order).toEqual(["a", "b", "c"]);
  });

  it("bradley-terry stays finite for an entry that never lost", () => {
    const strengths = fitBradleyTerry(
      [
        { winner: "a", loser: "b", weight: 1 },
        { winner: "a", loser: "c", weight: 1 },
      ],
      ["a", "b", "c"],
    );
    for (const value of Object.values(strengths)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(strengths['a']).toBeGreaterThan(strengths['b']!);
  });

  it("is deterministic and returns all four rules", () => {
    const reviews = [review("j1", "a", 8), review("j1", "b", 4), review("j2", "b", 9)];
    const first = aggregateAll({ criteria, reviews, submissionIds: ["a", "b"] });
    const second = aggregateAll({ criteria, reviews, submissionIds: ["b", "a"] });
    expect(first.map((r) => r.rule)).toEqual([
      "rawAverage",
      "calibrated",
      "bradleyTerry",
      "borda",
    ]);
    expect(second.map((r) => r.order)).toEqual(first.map((r) => r.order));
  });
});
