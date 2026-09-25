/**
 * Prize-boundary-targeted review allocation.
 *
 * Balanced assignment (assignment.ts) is the right way to start an event: every
 * project gets equal attention before anything is known. Once scores exist,
 * spreading the remaining judge-hours evenly is wasteful — most of the ranking
 * is already settled, and the places that decide prizes are not.
 *
 * `nextReviewTargets` takes the certificate's priority list and turns it into
 * concrete judge/project pairs, obeying the same fairness rules as the initial
 * assignment: no self-review, no conflicts, and workloads kept level.
 */

import type { AssignmentJudge, AssignmentSubmission, ExistingPair } from "./assignment";
import type { ReviewSuggestion } from "./robustness";

export type ReviewTarget = {
  judgeId: string;
  submissionId: string;
  priority: number;
  reasons: string[];
};

const key = (p: ExistingPair) => `${p.judgeId}::${p.submissionId}`;

export function nextReviewTargets(input: {
  submissions: AssignmentSubmission[];
  judges: AssignmentJudge[];
  existing?: ExistingPair[];
  conflicts?: ExistingPair[];
  /** output of reviewPriority / certifyDecision().suggestions */
  suggestions: ReviewSuggestion[];
  /** how many extra reviews to plan in total */
  maxTargets?: number;
  /** cap on extra reviews handed to any one judge */
  maxExtraPerJudge?: number;
}): ReviewTarget[] {
  const maxTargets = input.maxTargets ?? 10;
  const maxExtraPerJudge = input.maxExtraPerJudge ?? 3;

  const judges = (input.judges ?? [])
    .filter((j) => j.active !== false)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const submissionsById = new Map((input.submissions ?? []).map((s) => [s.id, s]));

  const conflicts = new Set((input.conflicts ?? []).map(key));
  const taken = new Set((input.existing ?? []).map(key));

  const loads: Record<string, number> = {};
  for (const judge of judges) loads[judge.id] = 0;
  for (const pair of input.existing ?? []) {
    loads[pair.judgeId] = (loads[pair.judgeId] ?? 0) + 1;
  }
  const extra: Record<string, number> = {};

  const targets: ReviewTarget[] = [];

  for (const suggestion of input.suggestions) {
    if (targets.length >= maxTargets) break;
    const submission = submissionsById.get(suggestion.submissionId);
    if (!submission) continue;

    const candidates = judges.filter((judge) => {
      if ((extra[judge.id] ?? 0) >= maxExtraPerJudge) return false;
      if (taken.has(key({ judgeId: judge.id, submissionId: submission.id }))) return false;
      if (conflicts.has(key({ judgeId: judge.id, submissionId: submission.id }))) return false;
      if (judge.userId && submission.ownerId && judge.userId === submission.ownerId) return false;
      return true;
    });
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const diff = (loads[a.id] ?? 0) - (loads[b.id] ?? 0);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    const chosen = candidates[0]!;
    taken.add(key({ judgeId: chosen.id, submissionId: submission.id }));
    loads[chosen.id] = (loads[chosen.id] ?? 0) + 1;
    extra[chosen.id] = (extra[chosen.id] ?? 0) + 1;
    targets.push({
      judgeId: chosen.id,
      submissionId: submission.id,
      priority: suggestion.priority,
      reasons: suggestion.reasons,
    });
  }

  return targets;
}
