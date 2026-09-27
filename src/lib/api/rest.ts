/**
 * REST API (T4 / API-First): every core lifecycle action the UI can take,
 * over plain JSON. Session-cookie auth, same validation and authorization
 * rules as the server functions (which remain the canonical implementations
 * for RPC flows). Documented in openapi.ts.
 */

import { getSessionToken, getSessionUser, type SessionUser } from "../auth/session-store";
import { mapEventRow, mapSubmissionRow } from "../db-rows";
import { normalizeScores, weightedTotal } from "../engine/normalize";
import { getAnswers, getMedia } from "../hackathon.functions";
import { reviewSchema } from "../judge.functions";
import { logAudit } from "../mesh/audit";
import { emailVoterKey, getVotingConfig } from "../mesh/community.functions";
import { meshPool } from "../mesh/db";
import { loadJudgeScopes } from "../mesh/scopes";
import { triggerWebhooks } from "../mesh/webhooks";
import { submissionSchema } from "../participant.functions";
import { submissionWindowStatus } from "../submit-payload";
import { loadEventReviews } from "../review-data";
import { OPENAPI } from "./openapi";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authedUser(request: Request): Promise<SessionUser | null> {
  const token = getSessionToken(request);
  return token ? getSessionUser(token) : null;
}

async function organizerOr401(request: Request): Promise<SessionUser | Response> {
  const user = await authedUser(request);
  if (!user) return json({ error: "Authentication required." }, 401);
  const { rows } = await meshPool().query(
    "select 1 from public.user_roles where user_id = $1 and role in ('organizer', 'admin')",
    [user.id],
  );
  if (rows.length === 0) return json({ error: "Forbidden: organizer role required." }, 403);
  return user;
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/")) return null;
  if (pathname === "/api/openapi.json") return json(OPENAPI);

  const segments = pathname.slice("/api/".length).split("/");

  try {
    // ----- public reads -----
    if (request.method === "GET" && segments[0] === "events" && segments.length === 1) {
      const { rows } = await meshPool().query("select * from public.events order by created_at asc");
      return json({ events: (rows as Record<string, unknown>[]).map(mapEventRow) });
    }
    if (request.method === "GET" && segments[0] === "events" && segments[1] && UUID_RE.test(segments[1])) {
      const pool = meshPool();
      const { rows } = await pool.query("select * from public.events where id = $1", [segments[1]]);
      const raw = rows[0] as Record<string, unknown> | undefined;
      if (!raw) return json({ error: "Event not found." }, 404);
      const [tracks, criteria, prizes] = await Promise.all([
        pool.query("select id, name, slug from public.tracks where event_id = $1 order by name", [segments[1]]),
        pool.query("select id, name, description, weight, min_score, max_score, position from public.criteria where event_id = $1 order by position", [segments[1]]),
        pool.query("select id, position, title, amount from public.prizes where event_id = $1 order by position asc", [segments[1]]).catch(() => ({ rows: [] })),
      ]);
      return json({
        event: mapEventRow(raw),
        tracks: tracks.rows,
        criteria: (criteria.rows as Record<string, unknown>[]).map((c) => ({ ...c, weight: Number(c["weight"]) })),
        prizes: prizes.rows,
      });
    }
    if (request.method === "GET" && segments[0] === "submissions" && segments.length === 1) {
      const eventId = url.searchParams.get("eventId");
      const pool = meshPool();
      const { rows } = eventId
        ? await pool.query("select * from public.submissions where event_id = $1 and status = 'submitted' order by created_at asc", [eventId])
        : await pool.query("select * from public.submissions where status = 'submitted' order by created_at asc");
      return json({
        submissions: (rows as Record<string, unknown>[]).map((r) => mapSubmissionRow(r)),
      });
    }
    if (request.method === "GET" && segments[0] === "submissions" && segments[1] && UUID_RE.test(segments[1])) {
      const { rows } = await meshPool().query(
        "select * from public.submissions where id = $1 and status = 'submitted'",
        [segments[1]],
      );
      const raw = rows[0] as Record<string, unknown> | undefined;
      if (!raw) return json({ error: "Project not found." }, 404);
      const id = segments[1] as string;
      return json({ submission: { ...mapSubmissionRow(raw), media: await getMedia(id), answers: await getAnswers(id) } });
    }
    if (request.method === "GET" && segments[0] === "standings") {
      const eventId = url.searchParams.get("eventId") ?? "";
      if (!UUID_RE.test(eventId)) return json({ error: "eventId is required." }, 400);
      const config = await getVotingConfig(eventId);
      const user = await authedUser(request);
      let organizer = false;
      if (user) {
        const { rows } = await meshPool().query(
          "select 1 from public.user_roles where user_id = $1 and role in ('organizer', 'admin')",
          [user.id],
        );
        organizer = rows.length > 0;
      }
      if (!config.published && !organizer) return json({ published: false });
      const { rows } = await meshPool().query(
        `select v.submission_id, s.title,
                count(*) as ballots,
                case when $2 = 'quadratic' then sum(sqrt(v.votes::float)) else sum(v.votes) end as tally
         from public.votes v join public.submissions s on s.id = v.submission_id
         where v.event_id = $1 group by v.submission_id, s.title order by tally desc`,
        [eventId, config.mode],
      );
      return json({ published: true, standings: rows });
    }
    if (request.method === "GET" && segments[0] === "comments") {
      const submissionId = url.searchParams.get("submissionId") ?? "";
      if (!UUID_RE.test(submissionId)) return json({ error: "submissionId is required." }, 400);
      const { rows } = await meshPool().query(
        `select c.id, c.body, c.created_at, coalesce(u.display_name, 'Community') as author
         from public.comments c left join public.users u on u.id::text = c.author_key
         where c.submission_id = $1 and c.hidden = false order by c.created_at asc limit 100`,
        [submissionId],
      );
      return json({ comments: rows });
    }

    // ----- authenticated writes -----
    if (request.method === "POST" && segments[0] === "submissions" && segments.length === 1) {
      const user = await authedUser(request);
      if (!user) return json({ error: "Authentication required." }, 401);
      const parsed = submissionSchema.safeParse(await parseJson(request));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, 400);
      const data = parsed.data;
      const pool = meshPool();
      const { rows: eventRows } = await pool.query("select id, submissions_open, ends_at from public.events where id = $1", [
        data.eventId,
      ]);
      const event = eventRows[0] as { submissions_open: boolean; ends_at: Date | string | null } | undefined;
      const window = submissionWindowStatus(
        event
          ? {
              submissions_open: event.submissions_open,
              ends_at: event.ends_at instanceof Date ? event.ends_at.toISOString() : event.ends_at,
            }
          : null,
      );
      if (data.status === "submitted" && !window.submitsAllowed) {
        return json({ error: window.reason || "Submissions are closed." }, 422);
      }
      if (data.status === "draft" && !window.savesAllowed) {
        return json({ error: window.reason || "Event not found." }, 422);
      }
      let id: string;
      if (data.id) {
        const { rows } = await pool.query(
          `update public.submissions set event_id=$1, track_id=$2, team_name=$3, title=$4, tagline=$5,
             description=$6, repo_url=$7, demo_url=$8, video_url=$9, tags=$10, status=$11
           where id=$12 and owner_id=$13 returning id`,
          [data.eventId, data.trackId ?? null, data.teamName, data.title, data.tagline || null, data.description || null, data.repoUrl || null, data.demoUrl || null, data.videoUrl || null, data.tags, data.status, data.id, user.id],
        );
        if (rows.length === 0) return json({ error: "Project not found or not yours to edit." }, 404);
        id = (rows[0] as { id: string }).id;
      } else {
        const { rows } = await pool.query(
          `insert into public.submissions
             (event_id, track_id, owner_id, team_name, title, tagline, description, repo_url, demo_url, video_url, tags, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [data.eventId, data.trackId ?? null, user.id, data.teamName, data.title, data.tagline || null, data.description || null, data.repoUrl || null, data.demoUrl || null, data.videoUrl || null, data.tags, data.status],
        );
        id = (rows[0] as { id: string }).id;
      }
      if (data.status === "submitted") {
        await logAudit({ eventId: data.eventId, actor: user.id, action: "submission.submitted", entity: "submissions", entityId: id });
        await triggerWebhooks("submission.submitted", { eventId: data.eventId, submissionId: id });
      }
      return json({ id }, 201);
    }

    if (request.method === "POST" && segments[0] === "reviews" && segments.length === 1) {
      const user = await authedUser(request);
      if (!user) return json({ error: "Authentication required." }, 401);
      const parsed = reviewSchema.safeParse(await parseJson(request));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, 400);
      const data = parsed.data;
      const pool = meshPool();
      const { rows } = await pool.query(
        `select a.id, a.event_id, a.judge_id, a.submission_id from public.assignments a
         join public.judges j on j.id = a.judge_id where a.id = $1 and j.user_id = $2`,
        [data.assignmentId, user.id],
      );
      const assignment = rows[0] as { id: string; event_id: string; judge_id: string; submission_id: string } | undefined;
      if (!assignment) return json({ error: "This review is not assigned to you." }, 403);
      const scopes = await loadJudgeScopes([assignment.judge_id]);
      const scope = scopes[assignment.judge_id];
      if (scope) {
        const { rows: subRows } = await pool.query("select track_id from public.submissions where id = $1", [
          assignment.submission_id,
        ]);
        if (((subRows[0] as { track_id: string | null } | undefined)?.track_id ?? null) !== scope) {
          return json({ error: "Forbidden: this project is outside your track." }, 403);
        }
      }
      const { rows: criteria } = await pool.query("select id, min_score, max_score from public.criteria where event_id = $1", [
        assignment.event_id,
      ]);
      const byId = new Map((criteria as { id: string; min_score: number; max_score: number }[]).map((c) => [c.id, c]));
      for (const score of data.scores) {
        const criterion = byId.get(score.criterionId);
        if (!criterion) return json({ error: "Unknown scoring criterion." }, 400);
        if (score.value < criterion.min_score || score.value > criterion.max_score) {
          return json({ error: `Scores must be between ${criterion.min_score} and ${criterion.max_score}.` }, 422);
        }
      }
      if (data.submit && data.scores.length !== criteria.length) {
        return json({ error: "Score every criterion before submitting the review." }, 422);
      }
      if (data.scores.length > 0) {
        const values = data.scores.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ");
        const params: (string | number)[] = [];
        for (const s of data.scores) params.push(data.assignmentId, s.criterionId, s.value);
        await pool.query(
          `insert into public.scores (assignment_id, criterion_id, value) values ${values}
           on conflict (assignment_id, criterion_id) do update set value = excluded.value, updated_at = now()`,
          params,
        );
      }
      await pool.query("update public.assignments set comment = $1, status = $2, submitted_at = $3 where id = $4", [
        data.comment || null,
        data.submit ? "submitted" : "draft",
        data.submit ? new Date().toISOString() : null,
        data.assignmentId,
      ]);
      if (data.submit) {
        await logAudit({ eventId: assignment.event_id, actor: user.id, action: "review.submitted", entity: "assignments", entityId: data.assignmentId });
        await triggerWebhooks("review.submitted", { eventId: assignment.event_id, assignmentId: data.assignmentId, submissionId: assignment.submission_id });
        const { issueParticipationRecord } = await import("../mesh/participation");
        await issueParticipationRecord({
          judgeId: assignment.judge_id,
          eventId: assignment.event_id,
          submissionId: assignment.submission_id,
          assignmentId: data.assignmentId,
        });
      }
      return json({ ok: true, status: data.submit ? "submitted" : "draft" });
    }

    // ----- participation record verification (public) -----
    if (request.method === "GET" && segments[0] === "verify-participation" && segments[1] && UUID_RE.test(segments[1])) {
      const { verifyParticipationRecord } = await import("../mesh/participation");
      const result = await verifyParticipationRecord(segments[1] as string);
      if (!result.record) return json({ error: "Record not found." }, 404);
      return json({ valid: result.valid, record: result.record, publicKey: result.publicKey });
    }

    if (request.method === "POST" && segments[0] === "votes" && segments.length === 1) {
      const user = await authedUser(request);
      if (!user) return json({ error: "Authentication required." }, 401);
      const body = (await parseJson(request)) as { eventId?: string; submissionId?: string; votes?: number; voterEmail?: string } | null;
      if (!body?.eventId || !UUID_RE.test(body.eventId) || !body.submissionId || !UUID_RE.test(body.submissionId)) {
        return json({ error: "eventId and submissionId are required." }, 400);
      }
      const { getVotingConfig: configOf } = await import("../mesh/community.functions");
      const config = await configOf(body.eventId).catch(() => null);
      if (!config) return json({ error: "Event not found." }, 404);
      if (config.mode === "off" || !config.open) return json({ error: "Voting is not open." }, 422);
      const voterKey = body.voterEmail ? emailVoterKey(body.voterEmail) : user.id;
      const pool = meshPool();
      const { rows: subRows } = await pool.query(
        "select id from public.submissions where id = $1 and event_id = $2 and status = 'submitted'",
        [body.submissionId, body.eventId],
      );
      if (subRows.length === 0) return json({ error: "Project not found or not submitted." }, 404);
      const { rows: recent } = await pool.query(
        "select count(*) as count from public.votes where event_id = $1 and voter_key = $2 and created_at > now() - interval '1 hour'",
        [body.eventId, voterKey],
      );
      if (Number((recent[0] as { count: string }).count) >= 30) {
        return json({ error: "Rate limit: too many votes this hour." }, 429);
      }
      const votes = config.mode === "quadratic" ? Math.min(5, Math.max(1, body.votes ?? 1)) : 1;
      await pool.query(
        `insert into public.votes (event_id, submission_id, voter_key, votes, updated_at) values ($1,$2,$3,$4,now())
         on conflict (event_id, submission_id, voter_key) do update set votes = excluded.votes, updated_at = now()`,
        [body.eventId, body.submissionId, voterKey, votes],
      );
      return json({ ok: true, votes });
    }

    if (request.method === "POST" && segments[0] === "comments" && segments.length === 1) {
      const user = await authedUser(request);
      if (!user) return json({ error: "Authentication required." }, 401);
      const body = (await parseJson(request)) as { submissionId?: string; body?: string } | null;
      const text = (body?.body ?? "").trim();
      if (!body?.submissionId || !UUID_RE.test(body.submissionId) || !text || text.length > 1000) {
        return json({ error: "submissionId and a body of 1-1000 characters are required." }, 400);
      }
      const pool = meshPool();
      const { rows: sub } = await pool.query("select event_id from public.submissions where id = $1 and status = 'submitted'", [
        body.submissionId,
      ]);
      if (sub.length === 0) return json({ error: "Project not found." }, 404);
      const { rows: recent } = await pool.query(
        "select count(*) as count from public.comments where author_key = $1 and created_at > now() - interval '1 hour'",
        [user.id],
      );
      if (Number((recent[0] as { count: string }).count) >= 10) {
        return json({ error: "Rate limit: too many comments this hour." }, 429);
      }
      const { rows } = await pool.query(
        "insert into public.comments (event_id, submission_id, author_key, body) values ($1,$2,$3,$4) returning id",
        [(sub[0] as { event_id: string }).event_id, body.submissionId, user.id, text],
      );
      return json({ id: (rows[0] as { id: string }).id }, 201);
    }

    // ----- organizer reads/writes -----
    if (request.method === "GET" && segments[0] === "leaderboard") {      const gate = await organizerOr401(request);
      if (gate instanceof Response) return gate;
      const eventId = url.searchParams.get("eventId") ?? "";
      if (!UUID_RE.test(eventId)) return json({ error: "eventId is required." }, 400);
      const { loadEventReviews } = await import("../review-data");
      const loaded = await loadEventReviews(eventId);
      const result = normalizeScores({
        criteria: loaded.criteria,
        reviews: loaded.reviews,
        submissionIds: loaded.submissions.map((s) => s.id),
        minReviews: loaded.event.reviews_per_submission,
      });
      return json({ eventId, overallMean: result.overallMean, rows: result.rows, judgeStats: result.judgeStats });
    }

    if (request.method === "GET" && segments[0] === "export.json") {
      const gate = await organizerOr401(request);
      if (gate instanceof Response) return gate;
      const eventId = url.searchParams.get("eventId") ?? "";
      if (!UUID_RE.test(eventId)) return json({ error: "eventId is required." }, 400);
      const pool = meshPool();
      const q = (sql: string) => pool.query(sql, [eventId]).then((r) => r.rows);
      const [event, tracks, criteria, submissions, judges, assignments, scores, votes, comments, prizes] = await Promise.all([
        pool.query("select * from public.events where id = $1", [eventId]).then((r) => r.rows[0] ?? null),
        q("select * from public.tracks where event_id = $1 order by name"),
        q("select * from public.criteria where event_id = $1 order by position"),
        q("select * from public.submissions where event_id = $1 order by created_at asc"),
        q("select id, display_name, email, active from public.judges where event_id = $1"),
        q("select * from public.assignments where event_id = $1"),
        pool.query("select s.* from public.scores s join public.assignments a on a.id = s.assignment_id where a.event_id = $1", [eventId]).then((r) => r.rows),
        q("select * from public.votes where event_id = $1"),
        q("select * from public.comments where event_id = $1 order by created_at asc"),
        q("select * from public.prizes where event_id = $1 order by position asc"),
      ]);
      return json({ event, tracks, criteria, submissions, judges, assignments, scores, votes, comments, prizes, exportedAt: new Date().toISOString() });
    }

    if (request.method === "POST" && segments[0] === "import.json") {
      const gate = await organizerOr401(request);
      if (gate instanceof Response) return gate;
      const body = (await parseJson(request)) as { eventId?: string; projects?: unknown[] } | null;
      if (!body?.eventId || !UUID_RE.test(body.eventId) || !Array.isArray(body.projects) || body.projects.length > 200) {
        return json({ error: "eventId and up to 200 projects are required." }, 400);
      }
      const pool = meshPool();
      const ids: string[] = [];
      for (const raw of body.projects) {
        const parsed = submissionSchema.safeParse({ ...(raw as object), eventId: body.eventId, status: "draft", tags: [] });
        if (!parsed.success) return json({ error: `Invalid project: ${parsed.error.issues[0]?.message}` }, 400);
        const d = parsed.data;
        const { rows } = await pool.query(
          `insert into public.submissions
             (event_id, track_id, owner_id, team_name, title, tagline, description, repo_url, demo_url, video_url, tags, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft') returning id`,
          [d.eventId, d.trackId ?? null, gate.id, d.teamName, d.title, d.tagline || null, d.description || null, d.repoUrl || null, d.demoUrl || null, d.videoUrl || null, d.tags],
        );
        ids.push((rows[0] as { id: string }).id);
      }
      await logAudit({ eventId: body.eventId, actor: gate.id, action: "submission.imported", entity: "submissions", detail: { created: ids.length } });
      return json({ created: ids.length, ids }, 201);
    }

    // ----- judge scores (acceptance T2: own 200, peer 401/403) -----
    if (segments[0] === "judge" && segments[1] === "scores") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      const user = await authedUser(request);
      if (!user) return json({ error: "Authentication required." }, 401);
      const pool = meshPool();
      const { rows: myJudges } = await pool.query(
        "select id, event_id, display_name from public.judges where user_id = $1",
        [user.id],
      );
      const mine = myJudges as { id: string; event_id: string; display_name: string }[];
      const target = url.searchParams.get("judge");
      let judgeId: string;
      if (target) {
        // Resolve by row id or by email; anything else is refused, never leaked.
        const { rows } = await pool.query(
          "select id, event_id, display_name from public.judges where id::text = $1 or email = $2",
          [target, target],
        );
        const row = rows[0] as { id: string; event_id: string; display_name: string } | undefined;
        if (!row) return json({ error: "Forbidden: unknown judge scope." }, 403);
        const isMine = mine.some((j) => j.id === row.id);
        if (!isMine) {
          const { rows: roleRows } = await pool.query(
            "select 1 from public.user_roles where user_id = $1 and role in ('organizer', 'admin')",
            [user.id],
          );
          if (roleRows.length === 0) return json({ error: "Forbidden: not your scores." }, 403);
        }
        judgeId = row.id;
      } else {
        if (mine.length === 0) return json({ error: "Forbidden: judging role required." }, 403);
        judgeId = mine[0]!.id;
      }
      const { rows: assignments } = await pool.query(
        `select a.id, a.status, a.comment, a.submitted_at, s.id as submission_id, s.title, s.team_name
         from public.assignments a join public.submissions s on s.id = a.submission_id
         where a.judge_id = $1 order by a.created_at asc`,
        [judgeId],
      );
      const ids = (assignments as { id: string }[]).map((a) => a.id);
      let scoreRows: { assignment_id: string; criterion_id: string; value: string | number }[] = [];
      if (ids.length > 0) {
        const { rows } = await pool.query(
          "select assignment_id, criterion_id, value from public.scores where assignment_id = any ($1)",
          [ids],
        );
        scoreRows = rows as typeof scoreRows;
      }
      const { rows: criteria } = await pool.query(
        "select c.id, c.name from public.criteria c join public.assignments a on a.event_id = c.event_id where a.judge_id = $1 group by c.id, c.name, c.position order by min(c.position)",
        [judgeId],
      );
      const names = Object.fromEntries(
        (criteria as { id: string; name: string }[]).map((c) => [c.id, c.name]),
      );
      return json({
        judgeId,
        reviews: (assignments as Record<string, unknown>[]).map((a) => ({
          assignmentId: a["id"],
          status: a["status"],
          comment: a["comment"],
          submissionId: a["submission_id"],
          title: a["title"],
          teamName: a["team_name"],
          scores: scoreRows
            .filter((s) => s.assignment_id === a["id"])
            .map((s) => ({
              criterionId: s.criterion_id,
              criterion: names[s.criterion_id] ?? s.criterion_id,
              value: Number(s.value),
            })),
        })),
      });
    }

    // ----- CSV export (acceptance T2: organizer, CSV body) -----
    if (request.method === "GET" && segments[0] === "export.csv") {
      const gate = await organizerOr401(request);
      if (gate instanceof Response) return gate;
      const eventIdParam = url.searchParams.get("eventId");
      const pool = meshPool();
      const eventId = eventIdParam ?? await pool.query("select id from public.events order by created_at asc limit 1").then((r) => (r.rows[0] as { id: string } | undefined)?.id ?? "");
      if (!eventId) return json({ error: "No event found." }, 404);
      const { loadEventReviews } = await import("../review-data");
      const loaded = await loadEventReviews(eventId);
      const { normalizeScores: normalize, weightedTotal: total } = await import("../engine/normalize");
      const normalized = normalize({
        criteria: loaded.criteria,
        reviews: loaded.reviews,
        submissionIds: loaded.submissions.map((s) => s.id),
        minReviews: loaded.event.reviews_per_submission,
      });
      const normByPair = new Map<string, number>();
      for (const row of normalized.rows) {
        for (const review of row.reviews) {
          normByPair.set(`${review.judgeId}::${row.submissionId}`, review.normalizedTotal);
        }
      }
      const judges = Object.fromEntries(loaded.judges.map((j) => [j.id, j.display_name]));
      const submissions = Object.fromEntries(loaded.submissions.map((s) => [s.id, `${s.title} (${s.team_name})`]));
      const { toCsvRows } = await import("../engine/export-csv");
      const header = ["judge", "project", ...loaded.criteria.map((c) => c.name ?? "criterion"), "raw_total", "normalized_total"];
      const csv = toCsvRows(
        header,
        loaded.reviews.map((review) => [
          judges[review.judgeId] ?? review.judgeId,
          submissions[review.submissionId] ?? review.submissionId,
          ...loaded.criteria.map((criterion) => review.scores[criterion.id] ?? ""),
          total(review, loaded.criteria).toFixed(2),
          (normByPair.get(`${review.judgeId}::${review.submissionId}`) ?? 0).toFixed(2),
        ]),
      );
      return new Response(csv, {
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8" },
      });
    }

    return json({ error: "Unknown API route. See /api/openapi.json." }, 404);
  } catch (error) {
    // Never leak internals; audit-adjacent failures stay opaque.
    console.error("API error:", error);
    return json({ error: "Something went wrong." }, 500);
  }
}
