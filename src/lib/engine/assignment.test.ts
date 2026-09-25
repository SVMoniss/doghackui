import { describe, expect, it } from "vitest";

import { loadSpread, planAssignments } from "./assignment";

const judges = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `judge-${String(i + 1).padStart(2, "0")}` }));
const submissions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `sub-${String(i + 1).padStart(2, "0")}` }));

describe("planAssignments", () => {
  it("gives every submission the requested number of distinct judges", () => {
    const plan = planAssignments({
      submissions: submissions(12),
      judges: judges(5),
      reviewsPerSubmission: 3,
    });

    expect(plan.created).toHaveLength(36);
    expect(plan.shortfalls).toEqual([]);

    for (const s of submissions(12)) {
      const forSub = plan.created.filter((p) => p.submissionId === s.id);
      expect(forSub).toHaveLength(3);
      expect(new Set(forSub.map((p) => p.judgeId)).size).toBe(3);
    }
  });

  it("keeps judge workloads within one review of each other", () => {
    const plan = planAssignments({
      submissions: submissions(12),
      judges: judges(5),
      reviewsPerSubmission: 3,
    });
    expect(loadSpread(plan.loads)).toBeLessThanOrEqual(1);
  });

  it("is deterministic", () => {
    const input = { submissions: submissions(9), judges: judges(4), reviewsPerSubmission: 3 };
    expect(planAssignments(input).created).toEqual(planAssignments(input).created);
  });

  it("never assigns a judge to their own team's submission", () => {
    const plan = planAssignments({
      submissions: [{ id: "sub-01", ownerId: "user-a" }, ...submissions(5).slice(1)],
      judges: [{ id: "judge-01", userId: "user-a" }, ...judges(4).slice(1)],
      reviewsPerSubmission: 2,
    });
    expect(plan.created).not.toContainEqual({ judgeId: "judge-01", submissionId: "sub-01" });
  });

  it("respects declared conflicts of interest", () => {
    const plan = planAssignments({
      submissions: submissions(4),
      judges: judges(3),
      reviewsPerSubmission: 2,
      conflicts: [{ judgeId: "judge-02", submissionId: "sub-03" }],
    });
    expect(plan.created).not.toContainEqual({ judgeId: "judge-02", submissionId: "sub-03" });
  });

  it("preserves existing assignments and only fills gaps", () => {
    const existing = [{ judgeId: "judge-01", submissionId: "sub-01" }];
    const plan = planAssignments({
      submissions: submissions(3),
      judges: judges(3),
      reviewsPerSubmission: 2,
      existing,
    });
    expect(plan.created).not.toContainEqual(existing[0]);
    expect(plan.created.filter((p) => p.submissionId === "sub-01")).toHaveLength(1);
    expect(plan.loads["judge-01"]).toBeGreaterThanOrEqual(1);
  });

  it("reports a shortfall instead of double-booking when judges run out", () => {
    const plan = planAssignments({
      submissions: submissions(2),
      judges: judges(2),
      reviewsPerSubmission: 3,
    });
    expect(plan.shortfalls).toHaveLength(2);
    expect(plan.shortfalls[0]!.reviews).toBe(2);
  });

  it("keeps judges inside the tracks they cover", () => {
    const plan = planAssignments({
      submissions: [
        { id: "sub-01", trackId: "track-a" },
        { id: "sub-02", trackId: "track-b" },
      ],
      judges: judges(2),
      reviewsPerSubmission: 1,
      judgeTracks: { "judge-01": ["track-a"], "judge-02": ["track-b"] },
    });
    expect(plan.created).toContainEqual({ judgeId: "judge-01", submissionId: "sub-01" });
    expect(plan.created).toContainEqual({ judgeId: "judge-02", submissionId: "sub-02" });
  });

  it("never gives a scoped judge untracked or other-track submissions", () => {
    const plan = planAssignments({
      submissions: [
        { id: "sub-01", trackId: "track-a" },
        { id: "sub-02", trackId: null },
        { id: "sub-03", trackId: "track-b" },
      ],
      judges: judges(2),
      reviewsPerSubmission: 1,
      judgeTracks: { "judge-01": ["track-a"] },
    });
    const forScoped = plan.created.filter((p) => p.judgeId === "judge-01");
    expect(forScoped).toEqual([{ judgeId: "judge-01", submissionId: "sub-01" }]);
    // Unscoped judge-02 absorbs the rest.
    expect(plan.created).toContainEqual({ judgeId: "judge-02", submissionId: "sub-02" });
    expect(plan.created).toContainEqual({ judgeId: "judge-02", submissionId: "sub-03" });
  });
});
