import { meshPool } from "./mesh/db";

import type { Criterion, Review } from "./engine/normalize";

export type EventReviewData = {
  event: { id: string; reviews_per_submission: number };
  criteria: Criterion[];
  reviews: Review[];
  submissions: { id: string; title: string; team_name: string; owner_id: string | null }[];
  judges: { id: string; display_name: string }[];
};

/**
 * Loads everything the aggregation and certification engines need for one
 * event — from the self-host Postgres. Access control stays in the callers:
 * only organizer-or-wider flows may call this.
 */
export async function loadEventReviews(eventId: string): Promise<EventReviewData> {
  const pool = meshPool();
  const [eventRes, criteriaRes, submissionsRes, judgesRes, assignmentsRes] = await Promise.all([
    pool.query("select id, reviews_per_submission from public.events where id = $1", [eventId]),
    pool.query(
      "select id, name, weight, min_score, max_score from public.criteria where event_id = $1 order by position",
      [eventId],
    ),
    pool.query(
      "select id, title, team_name, owner_id from public.submissions where event_id = $1 and status = 'submitted' order by title",
      [eventId],
    ),
    pool.query("select id, display_name from public.judges where event_id = $1", [eventId]),
    pool.query(
      "select id, judge_id, submission_id from public.assignments where event_id = $1 and status = 'submitted'",
      [eventId],
    ),
  ]);

  const event = (eventRes.rows as { id: string; reviews_per_submission: number }[])[0];
  if (!event) throw new Error("Event not found.");

  const assignments = assignmentsRes.rows as { id: string; judge_id: string; submission_id: string }[];
  let scores: { assignment_id: string; criterion_id: string; value: string | number }[] = [];
  if (assignments.length > 0) {
    const { rows } = await pool.query(
      "select assignment_id, criterion_id, value from public.scores where assignment_id = any ($1)",
      [assignments.map((a) => a.id)],
    );
    scores = rows as typeof scores;
  }

  const byAssignment = new Map<string, Record<string, number>>();
  for (const score of scores) {
    const bucket = byAssignment.get(score.assignment_id) ?? {};
    bucket[score.criterion_id] = Number(score.value);
    byAssignment.set(score.assignment_id, bucket);
  }

  return {
    event: { id: event.id, reviews_per_submission: event.reviews_per_submission },
    criteria: (criteriaRes.rows as { id: string; name: string; weight: string | number; min_score: number; max_score: number }[]).map(
      (c) => ({
        id: c.id,
        name: c.name,
        weight: Number(c.weight),
        minScore: c.min_score,
        maxScore: c.max_score,
      }),
    ),
    reviews: assignments.map((assignment) => ({
      judgeId: assignment.judge_id,
      submissionId: assignment.submission_id,
      scores: byAssignment.get(assignment.id) ?? {},
    })),
    submissions: submissionsRes.rows as EventReviewData["submissions"],
    judges: judgesRes.rows as EventReviewData["judges"],
  };
}

/** Stable, non-identifying labels so a team can talk about "Judge B" safely. */
export function anonymiseJudges(judgeIds: string[]): Record<string, string> {
  const sorted = [...new Set(judgeIds)].sort();
  return Object.fromEntries(
    sorted.map((id, index) => [id, `Judge ${String.fromCharCode(65 + (index % 26))}`]),
  );
}
