import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { meshPool } from "./mesh/db";
import { mapEventRow, mapSubmissionRow, type EventRow } from "./db-rows";

type TrackRow = { id: string; name: string; slug: string };
type CriterionRow = {
  id: string;
  name: string;
  description: string | null;
  weight: string | number;
  min_score: number;
  max_score: number;
  position: number;
};

export type { EventRow };

const iso = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

/** Public event overview: event, tracks, criteria, prizes, submission count. */
export const getEventOverview = createServerFn({ method: "GET" }).handler(async () => {
  const pool = meshPool();
  const { rows } = await pool.query(
    "select * from public.events order by created_at asc limit 1",
  );
  const raw = rows[0] as Record<string, unknown> | undefined;
  if (!raw) return null;
  const event = mapEventRow(raw);
  const eventId = event.id;

  const [tracksRes, criteriaRes, countRes, prizesRes] = await Promise.all([
    pool.query("select id, name, slug from public.tracks where event_id = $1 order by name", [eventId]),
    pool.query(
      "select id, name, description, weight, min_score, max_score, position from public.criteria where event_id = $1 order by position",
      [eventId],
    ),
    pool.query(
      "select count(*) as count from public.submissions where event_id = $1 and status = 'submitted'",
      [eventId],
    ),
    pool.query("select id, position, title, amount from public.prizes where event_id = $1 order by position asc", [
      eventId,
    ]).catch(() => ({ rows: [] })),
  ]);

  return {
    event,
    tracks: (tracksRes.rows as TrackRow[]).map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
    criteria: (criteriaRes.rows as CriterionRow[]).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      weight: Number(c.weight),
      min_score: c.min_score,
      max_score: c.max_score,
      position: c.position,
    })),
    submissionCount: Number((countRes.rows[0] as { count: string }).count),
    prizes: prizesRes.rows as { id: string; position: number; title: string; amount: string }[],
  };
});

/** Public gallery of submitted projects. */
export const listSubmissions = createServerFn({ method: "GET" }).handler(async () => {
  const { rows } = await meshPool().query(
    `select s.id, s.title, s.tagline, s.team_name, s.tags, s.repo_url, s.demo_url,
            s.video_url, s.track_id, s.created_at, t.name as track_name,
            m.thumbnail_url as thumb
     from public.submissions s left join public.tracks t on t.id = s.track_id
     left join public.submission_media m on m.submission_id = s.id
     where s.status = 'submitted' order by s.created_at asc`,
  );
  return (rows as Record<string, unknown>[]).map((s) => {
    const row = mapSubmissionRow(s);
    return {
      ...row,
      tracks: s["track_name"] ? { name: s["track_name"] as string } : null,
      thumbnailUrl: (s["thumb"] as string | null) ?? null,
    };
  });
});

export const getSubmission = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { rows } = await meshPool().query(
      `select s.*, t.name as track_name from public.submissions s
       left join public.tracks t on t.id = s.track_id
       where s.id = $1 and s.status = 'submitted'`,
      [data.id],
    );
    const submission = rows[0] as Record<string, unknown> | undefined;
    if (!submission) return null;
    const row = mapSubmissionRow(submission);
    return {
      ...row,
      tracks: submission["track_name"] ? { name: submission["track_name"] as string } : null,
      media: await getMedia(data.id),
      answers: await getAnswers(data.id),
    };
  });

export async function getMedia(submissionId: string): Promise<{ thumbnail_url: string; images: string[] }> {  const fallback = { thumbnail_url: "", images: [] as string[] };
  try {
    const { rows } = await meshPool().query(
      "select thumbnail_url, images from public.submission_media where submission_id = $1",
      [submissionId],
    );
    const row = rows[0] as { thumbnail_url: string; images: string[] } | undefined;
    return row ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getAnswers(
  submissionId: string,
): Promise<{ questionId: string; label: string; value: string }[]> {
  try {
    const { meshPool } = await import("./mesh/db");
    const { rows } = await meshPool().query(
      `select q.id as question_id, q.label, a.value from public.submission_answers a
       join public.custom_questions q on q.id = a.question_id
       where a.submission_id = $1 and a.value <> '' order by q.position asc`,
      [submissionId],
    );
    return (rows as { question_id: string; label: string; value: string }[]).map((r) => ({
      questionId: r.question_id,
      label: r.label,
      value: r.value,
    }));
  } catch {
    return [];
  }
}
