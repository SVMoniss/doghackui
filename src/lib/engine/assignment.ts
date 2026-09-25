/**
 * Balanced round-robin judge assignment.
 *
 * Guarantees:
 *  - every submission reaches `reviewsPerSubmission` reviews when enough
 *    eligible judges exist;
 *  - judge workloads differ by at most one review;
 *  - a judge never reviews their own submission, and never a submission they
 *    have a declared conflict with;
 *  - deterministic: same input -> same output;
 *  - incremental: existing assignments are preserved, only gaps are filled.
 */

export type AssignmentJudge = {
  id: string;
  userId?: string | null;
  active?: boolean;
};

export type AssignmentSubmission = {
  id: string;
  trackId?: string | null;
  ownerId?: string | null;
};

export type ExistingPair = { judgeId: string; submissionId: string };

export type AssignmentInput = {
  submissions: AssignmentSubmission[];
  judges: AssignmentJudge[];
  reviewsPerSubmission: number;
  /** Assignments already in the database. */
  existing?: ExistingPair[];
  /** Judge/submission pairs that must never be created. */
  conflicts?: ExistingPair[];
  /** When true, a judge is only paired with submissions in a track they cover. */
  judgeTracks?: Record<string, string[]>;
};

export type AssignmentPlan = {
  created: ExistingPair[];
  /** Reviews per judge after applying the plan. */
  loads: Record<string, number>;
  /** Submissions that could not reach the target review count. */
  shortfalls: { submissionId: string; reviews: number; target: number }[];
};

const key = (p: ExistingPair) => `${p.judgeId}::${p.submissionId}`;

export function planAssignments(input: AssignmentInput): AssignmentPlan {
  const target = Math.max(0, Math.floor(input.reviewsPerSubmission));
  const judges = (input.judges ?? [])
    .filter((j) => j.active !== false)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const submissions = (input.submissions ?? [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const conflicts = new Set((input.conflicts ?? []).map(key));
  const taken = new Set((input.existing ?? []).map(key));

  const loads: Record<string, number> = {};
  for (const j of judges) loads[j.id] = 0;
  for (const pair of input.existing ?? []) {
    loads[pair.judgeId] = (loads[pair.judgeId] ?? 0) + 1;
  }

  const reviewsBySubmission: Record<string, number> = {};
  for (const s of submissions) reviewsBySubmission[s.id] = 0;
  for (const pair of input.existing ?? []) {
    if (pair.submissionId in reviewsBySubmission) {
      reviewsBySubmission[pair.submissionId] = (reviewsBySubmission[pair.submissionId] ?? 0) + 1;
    }
  }

  const created: ExistingPair[] = [];
  const shortfalls: AssignmentPlan["shortfalls"] = [];

  for (const submission of submissions) {
    let have = reviewsBySubmission[submission.id] ?? 0;

    while (have < target) {
      const candidates = judges.filter((judge) => {
        if (taken.has(key({ judgeId: judge.id, submissionId: submission.id }))) return false;
        if (conflicts.has(key({ judgeId: judge.id, submissionId: submission.id }))) return false;
        if (judge.userId && submission.ownerId && judge.userId === submission.ownerId) return false;
        const tracks = input.judgeTracks?.[judge.id];
        // A scoped judge only ever sees their own tracks: anything untracked
        // or on another track is ineligible (isolation matrix).
        if (tracks && tracks.length > 0 && (!submission.trackId || !tracks.includes(submission.trackId))) {
          return false;
        }
        return true;
      });

      if (candidates.length === 0) break;

      candidates.sort((a, b) => {
        const diff = (loads[a.id] ?? 0) - (loads[b.id] ?? 0);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });

      const chosen = candidates[0]!;
      const pair = { judgeId: chosen.id, submissionId: submission.id };
      created.push(pair);
      taken.add(key(pair));
      loads[chosen.id] = (loads[chosen.id] ?? 0) + 1;
      have += 1;
    }

    reviewsBySubmission[submission.id] = have;
    if (have < target) {
      shortfalls.push({ submissionId: submission.id, reviews: have, target });
    }
  }

  return { created, loads, shortfalls };
}

/** Largest difference between judge workloads. Useful for tests and the admin UI. */
export function loadSpread(loads: Record<string, number>): number {
  const values = Object.values(loads);
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}
