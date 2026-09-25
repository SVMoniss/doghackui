import { createHash } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth/require-auth";
import { mapEventRow } from "./db-rows";
import { loadSpread, planAssignments } from "./engine/assignment";
import { toCsvRows } from "./engine/export-csv";
import { normalizeScores, type Review, weightedTotal } from "./engine/normalize";
import { certifyDecision } from "./engine/robustness";
import { nextReviewTargets } from "./engine/targeting";
import { logAudit } from "./mesh/audit";
import { meshPool } from "./mesh/db";
import { loadJudgeScopes } from "./mesh/scopes";
import { loadEventReviews } from "./review-data";

type AuthedContext = { userId: string };

async function hasAnyRole(userId: string, roles: string[]): Promise<boolean> {
  const { rows } = await meshPool().query(
    "select 1 from public.user_roles where user_id = $1 and role = any ($2)",
    [userId, roles],
  );
  return rows.length > 0;
}

async function assertOrganizer(context: AuthedContext) {
  if (!(await hasAnyRole(context.userId, ["organizer", "admin"]))) {
    throw new Error("Forbidden: organizer role required.");
  }
}

/** Platform admins: everything organizers can do, plus role grants. */
async function assertAdmin(context: AuthedContext) {
  if (!(await hasAnyRole(context.userId, ["admin"]))) {
    throw new Error("Forbidden: admin role required.");
  }
}

export const organizerDashboard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();

    const { rows: eventRows } = data.eventId
      ? await pool.query("select * from public.events where id = $1", [data.eventId])
      : await pool.query("select * from public.events order by created_at asc limit 1");
    const eventRaw = eventRows[0] as Record<string, unknown> | undefined;
    if (!eventRaw) return null;
    const event = mapEventRow(eventRaw);
    const eventId = event.id;

    const [tracksRes, criteriaRes, judgesRes, submissionsRes, assignmentsRes, conflictsRes] =
      await Promise.all([
        pool.query("select * from public.tracks where event_id = $1 order by name", [eventId]),
        pool.query("select * from public.criteria where event_id = $1 order by position", [eventId]),
        pool.query("select * from public.judges where event_id = $1 order by display_name", [eventId]),
        pool.query(
          "select id, title, team_name, status, track_id, owner_id from public.submissions where event_id = $1 order by title",
          [eventId],
        ),
        pool.query("select id, judge_id, submission_id, status from public.assignments where event_id = $1", [
          eventId,
        ]),
        pool.query(
          `select distinct c.judge_id, c.submission_id from public.conflicts c
           join public.submissions s on s.id = c.submission_id where s.event_id = $1`,
          [eventId],
        ),
      ]);

    return {
      event,
      tracks: tracksRes.rows,
      criteria: (criteriaRes.rows as Record<string, unknown>[]).map((c) => ({
        id: c["id"] as string,
        event_id: c["event_id"] as string,
        name: c["name"] as string,
        description: (c["description"] as string | null) ?? null,
        weight: Number(c["weight"]),
        min_score: c["min_score"] as number,
        max_score: c["max_score"] as number,
        position: c["position"] as number,
      })),
      judges: (judgesRes.rows as Record<string, unknown>[]).map((j) => ({
        id: j["id"] as string,
        event_id: j["event_id"] as string,
        user_id: (j["user_id"] as string | null) ?? null,
        display_name: j["display_name"] as string,
        email: (j["email"] as string | null) ?? null,
        active: Boolean(j["active"]),
      })),
      submissions: (submissionsRes.rows as Record<string, unknown>[]).map((s) => ({
        id: s["id"] as string,
        title: s["title"] as string,
        team_name: s["team_name"] as string,
        status: s["status"] as string,
        track_id: (s["track_id"] as string | null) ?? null,
        owner_id: (s["owner_id"] as string | null) ?? null,
      })),
      assignments: (assignmentsRes.rows as Record<string, unknown>[]).map((a) => ({
        id: a["id"] as string,
        judge_id: a["judge_id"] as string,
        submission_id: a["submission_id"] as string,
        status: a["status"] as string,
      })),
      conflicts: (conflictsRes.rows as Record<string, unknown>[]).map((c) => ({
        judge_id: c["judge_id"] as string,
        submission_id: c["submission_id"] as string,
      })),
      scopes: await loadJudgeScopes((judgesRes.rows as { id: string }[]).map((j) => j.id)),
    };
  });

export const updateEventSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        submissionsOpen: z.boolean(),
        judgingOpen: z.boolean(),
        reviewsPerSubmission: z.number().int().min(1).max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    await meshPool().query(
      `update public.events set submissions_open = $1, judging_open = $2,
         reviews_per_submission = $3 where id = $4`,
      [data.submissionsOpen, data.judgingOpen, data.reviewsPerSubmission, data.eventId],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "event.settings.updated",
      entity: "events",
      entityId: data.eventId,
      detail: {
        submissionsOpen: data.submissionsOpen,
        judgingOpen: data.judgingOpen,
        reviewsPerSubmission: data.reviewsPerSubmission,
      },
    });
    return { ok: true };
  });

export const addJudge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        displayName: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(255).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();

    let userId: string | null = null;
    if (data.email) {
      const { rows } = await pool.query("select id from public.users where email = $1", [data.email]);
      userId = (rows[0] as { id: string } | undefined)?.id ?? null;
    }

    const { rows } = await pool.query(
      `insert into public.judges (event_id, display_name, email, user_id)
       values ($1, $2, $3, $4) returning id`,
      [data.eventId, data.displayName, data.email || null, userId],
    );
    const judgeId = (rows[0] as { id: string }).id;

    // Linking an existing account also grants the judge role.
    if (userId) {
      await pool.query(
        "insert into public.user_roles (user_id, role) values ($1, 'judge') on conflict (user_id, role) do nothing",
        [userId],
      );
    }

    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "judge.added",
      entity: "judges",
      entityId: judgeId,
      detail: { displayName: data.displayName, linked: Boolean(userId) },
    });
    return { id: judgeId, linked: Boolean(userId) };
  });

export const removeJudge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    await meshPool().query("delete from public.judges where id = $1", [data.id]);
    await logAudit({
      actor: context.userId,
      action: "judge.removed",
      entity: "judges",
      entityId: data.id,
    });
    return { ok: true };
  });

export const setConflict = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        judgeId: z.string().uuid(),
        submissionId: z.string().uuid(),
        conflicted: z.boolean(),
        reason: z.string().trim().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();
    if (data.conflicted) {
      await pool.query(
        `insert into public.conflicts (judge_id, submission_id, reason) values ($1, $2, $3)
         on conflict (judge_id, submission_id) do update set reason = excluded.reason`,
        [data.judgeId, data.submissionId, data.reason || null],
      );
    } else {
      await pool.query("delete from public.conflicts where judge_id = $1 and submission_id = $2", [
        data.judgeId,
        data.submissionId,
      ]);
    }
    await logAudit({
      actor: context.userId,
      action: data.conflicted ? "conflict.declared" : "conflict.cleared",
      entity: "conflicts",
      entityId: `${data.judgeId}:${data.submissionId}`,
      detail: { reason: data.reason ?? "" },
    });
    return { ok: true };
  });

/**
 * Scope a judge to one track (null = all tracks). Scoped judges are never
 * assigned — and never shown — submissions outside their track.
 */
export const setJudgeScope = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ judgeId: z.string().uuid(), trackId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();
    const { rows } = await pool.query("select id, event_id from public.judges where id = $1", [data.judgeId]);
    const judge = rows[0] as { id: string; event_id: string } | undefined;
    if (!judge) throw new Error("Judge not found.");
    if (data.trackId) {
      const { rows: trackRows } = await pool.query(
        "select id from public.tracks where id = $1 and event_id = $2",
        [data.trackId, judge.event_id],
      );
      if (trackRows.length === 0) throw new Error("Track does not belong to this judge's event.");
      await pool.query(
        `insert into public.judge_scopes (judge_id, track_id, updated_at)
         values ($1, $2, now())
         on conflict (judge_id) do update set track_id = $2, updated_at = now()`,
        [data.judgeId, data.trackId],
      );
    } else {
      await pool.query("delete from public.judge_scopes where judge_id = $1", [data.judgeId]);
    }
    await logAudit({
      actor: context.userId,
      action: data.trackId ? "judge.scoped" : "judge.unscope",
      entity: "judges",
      entityId: data.judgeId,
      detail: { trackId: data.trackId ?? "" },
    });
    return { ok: true };
  });

/** Runs balanced round-robin assignment, keeping any reviews already in flight. */
export const runAssignment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: z.string().uuid(), dryRun: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();

    const [eventRes, judgesRes, submissionsRes, assignmentsRes, conflictsRes] = await Promise.all([
      pool.query("select id, reviews_per_submission from public.events where id = $1", [data.eventId]),
      pool.query("select id, user_id, active from public.judges where event_id = $1 and active = true", [
        data.eventId,
      ]),
      pool.query(
        "select id, track_id, owner_id from public.submissions where event_id = $1 and status = 'submitted'",
        [data.eventId],
      ),
      pool.query("select judge_id, submission_id from public.assignments where event_id = $1", [data.eventId]),
      pool.query(
        `select c.judge_id, c.submission_id from public.conflicts c
         join public.submissions s on s.id = c.submission_id where s.event_id = $1`,
        [data.eventId],
      ),
    ]);

    const event = (eventRes.rows as { id: string; reviews_per_submission: number }[])[0];
    if (!event) throw new Error("Event not found.");

    const scopes = await loadJudgeScopes(
      (judgesRes.rows as { id: string }[]).map((j) => j.id),
    );
    const judgeTracks: Record<string, string[]> = {};
    for (const [judgeId, trackId] of Object.entries(scopes)) {
      if (trackId) judgeTracks[judgeId] = [trackId];
    }

    const plan = planAssignments({
      submissions: (
        submissionsRes.rows as { id: string; track_id: string | null; owner_id: string | null }[]
      ).map((s) => ({ id: s.id, trackId: s.track_id, ownerId: s.owner_id })),
      judges: (judgesRes.rows as { id: string; user_id: string | null; active: boolean }[]).map((j) => ({
        id: j.id,
        userId: j.user_id,
        active: j.active,
      })),
      reviewsPerSubmission: event.reviews_per_submission,
      judgeTracks,
      existing: (assignmentsRes.rows as { judge_id: string; submission_id: string }[]).map((a) => ({
        judgeId: a.judge_id,
        submissionId: a.submission_id,
      })),
      conflicts: (conflictsRes.rows as { judge_id: string; submission_id: string }[]).map((c) => ({
        judgeId: c.judge_id,
        submissionId: c.submission_id,
      })),
    });

    if (!data.dryRun && plan.created.length > 0) {
      const values = plan.created.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(", ");
      const params: string[] = [data.eventId];
      for (const pair of plan.created) params.push(pair.judgeId, pair.submissionId);
      await pool.query(
        `insert into public.assignments (event_id, judge_id, submission_id) values ${values}`,
        params,
      );
      await logAudit({
        eventId: data.eventId,
        actor: context.userId,
        action: "assignment.round",
        entity: "assignments",
        detail: { created: plan.created.length, spread: loadSpread(plan.loads) },
      });
    }

    return {
      created: plan.created.length,
      loads: plan.loads,
      spread: loadSpread(plan.loads),
      shortfalls: plan.shortfalls,
      dryRun: data.dryRun,
    };
  });

export const leaderboard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) =>
    z.object({ eventId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();
    const loaded = await loadEventReviews(data.eventId);

    const { rows: trackRows } = await pool.query(
      `select s.id, t.name as track_name from public.submissions s
       left join public.tracks t on t.id = s.track_id where s.event_id = $1`,
      [data.eventId],
    );
    const trackNames = Object.fromEntries(
      (trackRows as { id: string; track_name: string | null }[]).map((r) => [r.id, r.track_name]),
    );

    const result = normalizeScores({
      criteria: loaded.criteria,
      reviews: loaded.reviews,
      submissionIds: loaded.submissions.map((s) => s.id),
      minReviews: loaded.event.reviews_per_submission,
    });

    const submissionsById = new Map(loaded.submissions.map((s) => [s.id, s]));
    const judgeNames = Object.fromEntries(loaded.judges.map((j) => [j.id, j.display_name]));

    return {
      reviewsPerSubmission: loaded.event.reviews_per_submission,
      overallMean: result.overallMean,
      overallStdDev: result.overallStdDev,
      judgeStats: result.judgeStats.map((s) => ({ ...s, judgeName: judgeNames[s.judgeId] ?? "—" })),
      rows: result.rows.map((row) => ({
        ...row,
        title: submissionsById.get(row.submissionId)?.title ?? "Unknown",
        teamName: submissionsById.get(row.submissionId)?.team_name ?? "—",
        trackName: trackNames[row.submissionId] ?? null,
      })),
    };
  });

export type LeaderboardPayload = Awaited<ReturnType<typeof leaderboard>>;

export const decisionCertificate = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string; prizePositions?: number }) =>
    z
      .object({ eventId: z.string().uuid(), prizePositions: z.number().int().min(1).max(20).default(3) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);

    const loaded = await loadEventReviews(data.eventId);
    const certificate = certifyDecision({
      criteria: loaded.criteria,
      reviews: loaded.reviews,
      submissionIds: loaded.submissions.map((s) => s.id),
      prizePositions: data.prizePositions,
      minReviews: loaded.event.reviews_per_submission,
    });

    const titles = Object.fromEntries(
      loaded.submissions.map((s) => [s.id, { title: s.title, teamName: s.team_name }]),
    );

    return { certificate, titles, prizePositions: data.prizePositions };
  });

export type DecisionCertificatePayload = Awaited<ReturnType<typeof decisionCertificate>>;

export const reviewTargets = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string; prizePositions?: number; maxTargets?: number }) =>
    z
      .object({
        eventId: z.string().uuid(),
        prizePositions: z.number().int().min(1).max(20).default(3),
        maxTargets: z.number().int().min(1).max(50).default(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();

    const loaded = await loadEventReviews(data.eventId);
    const certificate = certifyDecision({
      criteria: loaded.criteria,
      reviews: loaded.reviews,
      submissionIds: loaded.submissions.map((s) => s.id),
      prizePositions: data.prizePositions,
      minReviews: loaded.event.reviews_per_submission,
    });

    const [allAssignments, conflictsRes, judgesRes] = await Promise.all([
      pool.query("select judge_id, submission_id from public.assignments where event_id = $1", [data.eventId]),
      pool.query(
        `select c.judge_id, c.submission_id from public.conflicts c
         join public.submissions s on s.id = c.submission_id where s.event_id = $1`,
        [data.eventId],
      ),
      pool.query("select id, display_name, user_id, active from public.judges where event_id = $1", [
        data.eventId,
      ]),
    ]);

    const judgeRows = (judgesRes.rows as { id: string; display_name: string; user_id: string | null; active: boolean }[]).filter(
      (j) => j.active !== false,
    );
    const targets = nextReviewTargets({
      submissions: loaded.submissions.map((s) => ({ id: s.id, ownerId: s.owner_id ?? null })),
      judges: judgeRows.map((j) => ({ id: j.id, userId: j.user_id ?? null })),
      existing: (allAssignments.rows as { judge_id: string; submission_id: string }[]).map((a) => ({
        judgeId: a.judge_id,
        submissionId: a.submission_id,
      })),
      conflicts: (conflictsRes.rows as { judge_id: string; submission_id: string }[]).map((c) => ({
        judgeId: c.judge_id,
        submissionId: c.submission_id,
      })),
      suggestions: certificate.suggestions,
      maxTargets: data.maxTargets,
    });

    const judgeNames = Object.fromEntries(judgeRows.map((j) => [j.id, j.display_name]));
    const titles = Object.fromEntries(loaded.submissions.map((s) => [s.id, s.title]));

    return {
      verdict: certificate.overall,
      targets: targets.map((t) => ({
        ...t,
        judgeName: judgeNames[t.judgeId] ?? "Judge",
        title: titles[t.submissionId] ?? "Project",
      })),
    };
  });

export const applyReviewTargets = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string; pairs: { judgeId: string; submissionId: string }[] }) =>
    z
      .object({
        eventId: z.string().uuid(),
        pairs: z
          .array(z.object({ judgeId: z.string().uuid(), submissionId: z.string().uuid() }))
          .min(1)
          .max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);

    const values = data.pairs.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}, 'pending', true)`).join(", ");
    const params: string[] = [data.eventId];
    for (const pair of data.pairs) params.push(pair.judgeId, pair.submissionId);
    await meshPool().query(
      `insert into public.assignments (event_id, judge_id, submission_id, status, targeted) values ${values}
       on conflict (judge_id, submission_id) do update set status = 'pending', targeted = true`,
      params,
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "assignment.targeted",
      entity: "assignments",
      detail: { created: data.pairs.length },
    });
    return { created: data.pairs.length };
  });

/**
 * Freeze the rubric: records a weights snapshot hash so any mid-event drift
 * is detectable. Criteria are seed-managed; this ceremony plus the audit row
 * is the enforcement point until a criteria editor exists.
 */
export const freezeRubric = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const { rows } = await meshPool().query(
      "select id, name, weight from public.criteria where event_id = $1 order by position",
      [data.eventId],
    );
    const weightsHash = createHash("sha256")
      .update(
        JSON.stringify(
          (rows as { id: string; name: string; weight: string | number }[]).map((c) => [
            c.id,
            c.name,
            Number(c.weight),
          ]),
        ),
      )
      .digest("hex");
    await meshPool().query(
      `insert into public.rubric_freeze (event_id, frozen, frozen_at, frozen_by, weights_hash)
       values ($1, true, now(), $2, $3)
       on conflict (event_id)
       do update set frozen = true, frozen_at = now(), frozen_by = $2, weights_hash = $3`,
      [data.eventId, context.userId, weightsHash],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "rubric.frozen",
      entity: "rubric",
      entityId: data.eventId,
      detail: { weightsHash, criteria: rows.length },
    });
    return { ok: true, weightsHash };
  });

export const rubricFreezeState = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    try {
      const { rows } = await meshPool().query("select * from public.rubric_freeze where event_id = $1", [
        data.eventId,
      ]);
      return (rows[0] as { frozen: boolean; frozen_at: string | null; weights_hash: string } | undefined) ?? null;
    } catch {
      return null;
    }
  });

export const auditLog = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    try {
      const { rows } = await meshPool().query(
        "select action, actor, entity, entity_id, detail, created_at from public.audit_events where event_id = $1 or $1 is null order by created_at desc limit $2",
        [data.eventId, data.limit],
      );
      // Writers only store flat primitive details (strings/numbers/booleans).
      return rows as {
        action: string;
        actor: string;
        entity: string;
        entity_id: string;
        detail: Record<string, string | number | boolean | null>;
        created_at: string;
      }[];
    } catch {
      return [];
    }
  });

const slug = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and dashes.");

/** All events for the organizer's event switcher. */
export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertOrganizer(context);
    const { rows } = await meshPool().query(
      "select id, slug, name, starts_at, ends_at, submissions_open, judging_open from public.events order by created_at asc",
    );
    return (rows as Record<string, unknown>[]).map((e) => ({
      id: e["id"] as string,
      slug: e["slug"] as string,
      name: e["name"] as string,
      starts_at: iso(e["starts_at"]),
      ends_at: iso(e["ends_at"]),
      submissions_open: Boolean(e["submissions_open"]),
      judging_open: Boolean(e["judging_open"]),
    }));
  });

/** Create an event with configurable dates, tracks, and review load. */
export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        slug,
        tagline: z.string().trim().max(200).default(""),
        description: z.string().trim().max(5000).default(""),
        startsAt: z.string().datetime({ offset: true }).nullable().default(null),
        endsAt: z.string().datetime({ offset: true }).nullable().default(null),
        reviewsPerSubmission: z.number().int().min(1).max(20).default(3),
        tracks: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();
    const { rows } = await pool.query(
      `insert into public.events
         (slug, name, tagline, description, starts_at, ends_at, reviews_per_submission)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        data.slug,
        data.name,
        data.tagline || null,
        data.description || null,
        data.startsAt,
        data.endsAt,
        data.reviewsPerSubmission,
      ],
    );
    const eventId = (rows[0] as { id: string }).id;
    for (const [index, name] of data.tracks.entries()) {
      const trackSlug =
        `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "track"}-${index}`;
      await pool.query("insert into public.tracks (event_id, slug, name) values ($1, $2, $3)", [
        eventId,
        trackSlug,
        name,
      ]);
    }
    // A fresh event needs a rubric: seed the five fixed criteria.
    const { RUBRIC_CRITERIA } = await import("./rubric-defaults");
    for (const criterion of RUBRIC_CRITERIA) {
      await pool.query(
        `insert into public.criteria (event_id, name, description, weight, min_score, max_score, position)
         values ($1, $2, $3, $4, 1, 10, $5)`,
        [eventId, criterion.name, criterion.description, criterion.weight, criterion.position],
      );
    }
    await logAudit({
      actor: context.userId,
      action: "event.created",
      entity: "events",
      entityId: eventId,
      detail: { name: data.name, tracks: data.tracks.length },
    });
    return { id: eventId };
  });

export type PrizeRow = {
  id: string;
  position: number;
  title: string;
  amount: string;
};

export type CustomQuestion = {
  id: string;
  label: string;
  kind: "text" | "url" | "number" | "boolean";
  required: boolean;
  position: number;
};

/** Public: questions are part of the submission form, never secret. */
export const listQuestions = createServerFn({ method: "GET" })
  .inputValidator((input: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { rows } = await meshPool().query(
      "select id, label, kind, required, position from public.custom_questions where event_id = $1 order by position asc",
      [data.eventId],
    );
    return rows as CustomQuestion[];
  });

export const createQuestion = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        label: z.string().trim().min(1).max(200),
        kind: z.enum(["text", "url", "number", "boolean"]).default("text"),
        required: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const { rows: pos } = await meshPool().query(
      "select coalesce(max(position), 0) + 1 as position from public.custom_questions where event_id = $1",
      [data.eventId],
    );
    const { rows } = await meshPool().query(
      `insert into public.custom_questions (event_id, label, kind, required, position)
       values ($1, $2, $3, $4, $5) returning id`,
      [data.eventId, data.label, data.kind, data.required, (pos[0] as { position: number }).position],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "question.created",
      entity: "custom_questions",
      entityId: (rows[0] as { id: string }).id,
      detail: { label: data.label },
    });
    return { id: (rows[0] as { id: string }).id };
  });

export const deleteQuestion = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    await meshPool().query("delete from public.custom_questions where id = $1", [data.id]);
    await logAudit({ actor: context.userId, action: "question.deleted", entity: "custom_questions", entityId: data.id });
    return { ok: true };
  });

/** Public prize list for an event (empty when the prize store is absent). */
export const listPrizes = createServerFn({ method: "GET" })
  .inputValidator((input: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    try {
      const { rows } = await meshPool().query(
        "select id, position, title, amount from public.prizes where event_id = $1 order by position asc",
        [data.eventId],
      );
      return rows as PrizeRow[];
    } catch {
      return [];
    }
  });

export const createPrize = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        position: z.number().int().min(1).max(50),
        title: z.string().trim().min(1).max(120),
        amount: z.string().trim().max(60).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const { rows } = await meshPool().query(
      "insert into public.prizes (event_id, position, title, amount) values ($1, $2, $3, $4) returning id",
      [data.eventId, data.position, data.title, data.amount],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "prize.created",
      entity: "prizes",
      entityId: (rows[0] as { id: string }).id,
      detail: { title: data.title },
    });
    return { id: (rows[0] as { id: string }).id };
  });

export const deletePrize = createServerFn({ method: "POST" })  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    await meshPool().query("delete from public.prizes where id = $1", [data.id]);
    await logAudit({ actor: context.userId, action: "prize.deleted", entity: "prizes", entityId: data.id });
    return { ok: true };
  });

/** CSV export at every stage: assignments and per-review scores. */export const exportAssignmentsCsv = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();
    const [assignmentsRes, judgesRes, submissionsRes] = await Promise.all([
      pool.query(
        "select judge_id, submission_id, status, targeted, submitted_at from public.assignments where event_id = $1",
        [data.eventId],
      ),
      pool.query("select id, display_name from public.judges where event_id = $1", [data.eventId]),
      pool.query("select id, title, team_name from public.submissions where event_id = $1", [data.eventId]),
    ]);
    const judges = Object.fromEntries(
      (judgesRes.rows as { id: string; display_name: string }[]).map((j) => [j.id, j.display_name]),
    );
    const submissions = Object.fromEntries(
      (submissionsRes.rows as { id: string; title: string; team_name: string }[]).map((s) => [
        s.id,
        `${s.title} (${s.team_name})`,
      ]),
    );
    return {
      filename: "openjudge-assignments.csv",
      csv: toCsvRows(
        ["judge", "project", "status", "targeted", "submitted_at"],
        (
          assignmentsRes.rows as {
            judge_id: string;
            submission_id: string;
            status: string;
            targeted: boolean;
            submitted_at: Date | string | null;
          }[]
        ).map((a) => [
          judges[a.judge_id] ?? a.judge_id,
          submissions[a.submission_id] ?? a.submission_id,
          a.status,
          a.targeted ? "yes" : "no",
          a.submitted_at instanceof Date ? a.submitted_at.toISOString() : (a.submitted_at ?? ""),
        ]),
      ),
    };
  });

export const exportReviewsCsv = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const loaded = await loadEventReviews(data.eventId);
    const normalized = normalizeScores({
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
    const submissions = Object.fromEntries(
      loaded.submissions.map((s) => [s.id, `${s.title} (${s.team_name})`]),
    );
    const header = ["judge", "project", ...loaded.criteria.map((c) => c.name ?? "criterion"), "raw_total", "normalized_total"];
    return {
      filename: "openjudge-reviews.csv",
      csv: toCsvRows(
        header,
        loaded.reviews.map((review) => [
          judges[review.judgeId] ?? review.judgeId,
          submissions[review.submissionId] ?? review.submissionId,
          ...loaded.criteria.map((criterion) => review.scores[criterion.id] ?? ""),
          weightedTotal(review, loaded.criteria).toFixed(2),
          (normByPair.get(`${review.judgeId}::${review.submissionId}`) ?? 0).toFixed(2),
        ]),
      ),
    };
  });

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : (value as string);
}

const webhookUrl = z.string().trim().url().max(500);

/** Organizer-managed webhook subscriptions (HMAC-signed, best-effort). */
export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const { rows } = await meshPool().query(
      `select w.id, w.url, w.events, w.active, w.created_at,
              (select count(*) from public.webhook_deliveries d where d.subscription_id = w.id and d.status = 'failed') as failures
       from public.webhook_subscriptions w where w.event_id = $1 order by w.created_at desc`,
      [data.eventId],
    );
    return rows as {
      id: string;
      url: string;
      events: string[];
      active: boolean;
      created_at: string;
      failures: string;
    }[];
  });

export const createWebhook = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        url: webhookUrl,
        events: z.array(z.enum(["submission.submitted", "review.submitted", "voting.published", "eligibility.decided"])).max(10).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const { randomBytes } = await import("node:crypto");
    const secret = randomBytes(24).toString("hex");
    const { rows } = await meshPool().query(
      `insert into public.webhook_subscriptions (event_id, url, secret, events)
       values ($1, $2, $3, $4) returning id`,
      [data.eventId, data.url, secret, data.events],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "webhook.created",
      entity: "webhook_subscriptions",
      entityId: (rows[0] as { id: string }).id,
      detail: { url: data.url },
    });
    return { id: (rows[0] as { id: string }).id, secret };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    await meshPool().query("delete from public.webhook_subscriptions where id = $1", [data.id]);
    await logAudit({ actor: context.userId, action: "webhook.deleted", entity: "webhook_subscriptions", entityId: data.id });
    return { ok: true };
  });

/** Admin-only user directory with roles (for the Access card). */
export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { rows } = await meshPool().query(
      `select u.id, u.email, u.display_name,
              coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roles
       from public.users u left join public.user_roles r on r.user_id = u.id
       group by u.id order by u.email asc limit 200`,
    );
    return (rows as { id: string; email: string; display_name: string | null; roles: unknown }[]).map(
      (u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        // node-pg returns enum arrays as "{a,b}" strings, not JS arrays.
        roles:
          Array.isArray(u.roles) && u.roles.every((r) => typeof r === "string")
            ? (u.roles as string[])
            : typeof u.roles === "string"
              ? u.roles.replace(/^\{|\}$/g, "").split(",").filter(Boolean)
              : [],
      }),
    );
  });

const grantableRole = z.enum(["organizer", "judge", "participant", "admin"]);

export const grantRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), role: grantableRole }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await meshPool().query(
      "insert into public.user_roles (user_id, role) values ($1, $2) on conflict (user_id, role) do nothing",
      [data.userId, data.role],
    );
    await logAudit({
      actor: context.userId,
      action: "role.granted",
      entity: "users",
      entityId: data.userId,
      detail: { role: data.role },
    });
    return { ok: true };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), role: grantableRole }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const pool = meshPool();
    // Lockout guards: never remove the last organizer or your own last admin.
    if (data.role === "organizer") {
      const { rows } = await pool.query(
        "select count(*) as count from public.user_roles where role = 'organizer' and user_id <> $1",
        [data.userId],
      );
      if (Number((rows[0] as { count: string }).count) === 0) {
        const { rows: self } = await pool.query(
          "select 1 from public.user_roles where user_id = $1 and role = 'organizer'",
          [data.userId],
        );
        if (self.length > 0) throw new Error("Refusing to remove the last organizer.");
      }
    }
    if (data.role === "admin" && data.userId === context.userId) {
      const { rows } = await pool.query(
        "select count(*) as count from public.user_roles where role = 'admin' and user_id <> $1",
        [data.userId],
      );
      if (Number((rows[0] as { count: string }).count) === 0) {
        throw new Error("Refusing to remove your own last admin role.");
      }
    }
    await pool.query("delete from public.user_roles where user_id = $1 and role = $2", [
      data.userId,
      data.role,
    ]);
    await logAudit({
      actor: context.userId,
      action: "role.revoked",
      entity: "users",
      entityId: data.userId,
      detail: { role: data.role },
    });
    return { ok: true };
  });

/**
 * Reweight the rubric. Blocked once frozen (the freeze hash covers exactly
 * these weights), and the weights must sum to 1.00 — fixed per-project math
 * is never allowed, so the rule lives here, enforced, not documented.
 */
export const updateCriteria = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        criteria: z
          .array(
            z.object({
              id: z.string().uuid(),
              weight: z.number().positive().max(10),
              description: z.string().trim().max(500).optional(),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context);
    const pool = meshPool();
    const { rows: freezeRows } = await pool.query(
      "select 1 from public.rubric_freeze where event_id = $1 and frozen = true",
      [data.eventId],
    );
    if (freezeRows.length > 0) {
      throw new Error("Rubric is frozen — weights cannot change mid-event.");
    }
    const { rows: existing } = await pool.query("select id from public.criteria where event_id = $1", [
      data.eventId,
    ]);
    const ids = new Set((existing as { id: string }[]).map((c) => c.id));
    for (const criterion of data.criteria) {
      if (!ids.has(criterion.id)) throw new Error("Unknown criterion for this event.");
    }
    const sum = data.criteria.reduce((total, c) => total + c.weight, 0);
    if (Math.abs(sum - 1) > 0.002) {
      throw new Error(`Weights must sum to 1.00 (currently ${sum.toFixed(3)}).`);
    }
    for (const criterion of data.criteria) {
      await pool.query(
        "update public.criteria set weight = $1, description = coalesce($2, description) where id = $3",
        [criterion.weight, criterion.description ?? null, criterion.id],
      );
    }
    const weightsHash = createHash("sha256")
      .update(JSON.stringify(data.criteria.map((c) => [c.id, c.weight]).sort()))
      .digest("hex")
      .slice(0, 16);
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "rubric.reweighted",
      entity: "criteria",
      entityId: data.eventId,
      detail: { weightsHash, criteria: data.criteria.length },
    });
    return { ok: true, weightsHash };
  });
