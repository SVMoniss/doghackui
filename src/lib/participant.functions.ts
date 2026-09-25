import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth/require-auth";
import { mapSubmissionRow } from "./db-rows";
import { normalizeScores, weightedTotal } from "./engine/normalize";
import { certifyDecision } from "./engine/robustness";
import { logAudit } from "./mesh/audit";
import { meshPool } from "./mesh/db";
import { anonymiseJudges, loadEventReviews } from "./review-data";
import { submissionWindowStatus } from "./submit-payload";

const url = z.string().trim().url().max(500).optional().or(z.literal(""));

export const submissionSchema = z.object({
  id: z.string().uuid().optional(),
  eventId: z.string().uuid(),
  trackId: z.string().uuid().nullable().optional(),
  teamName: z.string().trim().min(1, "Team name is required").max(120),
  title: z.string().trim().min(1, "Title is required").max(160),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  repoUrl: url,
  demoUrl: url,
  videoUrl: url,
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  status: z.enum(["draft", "submitted"]).default("draft"),
});

export const myProjects = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { rows } = await meshPool().query(
      `select s.*, t.name as track_name from public.submissions s
       left join public.tracks t on t.id = s.track_id
       where s.owner_id = $1 order by s.created_at desc`,
      [context.userId],
    );
    return (rows as Record<string, unknown>[]).map((s) => {
      const row = mapSubmissionRow(s);
      return {
        ...row,
        tracks: s["track_name"] ? { name: s["track_name"] as string } : null,
      };
    });
  });

export const saveProject = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => submissionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    // Deadline enforcement is server-authoritative: the UI hint is not trust.
    const { rows: eventRows } = await pool.query(
      "select id, submissions_open, ends_at from public.events where id = $1",
      [data.eventId],
    );
    const event = eventRows[0] as
      | { id: string; submissions_open: boolean; ends_at: Date | string | null }
      | undefined;
    const window = submissionWindowStatus(
      event
        ? {
            submissions_open: event.submissions_open,
            ends_at: event.ends_at instanceof Date ? event.ends_at.toISOString() : event.ends_at,
          }
        : null,
    );
    if (data.status === "submitted" && !window.submitsAllowed) {
      throw new Error(window.reason || "Submissions are closed.");
    }
    if (data.status === "draft" && !window.savesAllowed) {
      throw new Error(window.reason || "Event not found.");
    }

    const row = {
      event_id: data.eventId,
      track_id: data.trackId ?? null,
      owner_id: context.userId,
      team_name: data.teamName,
      title: data.title,
      tagline: data.tagline || null,
      description: data.description || null,
      repo_url: data.repoUrl || null,
      demo_url: data.demoUrl || null,
      video_url: data.videoUrl || null,
      tags: data.tags,
      status: data.status,
    };

    let id: string;
    if (data.id) {
      const { rows } = await pool.query(
        `update public.submissions set event_id = $1, track_id = $2, team_name = $3, title = $4,
           tagline = $5, description = $6, repo_url = $7, demo_url = $8, video_url = $9, tags = $10, status = $11
         where id = $12 and owner_id = $13 returning id`,
        [
          row.event_id, row.track_id, row.team_name, row.title, row.tagline, row.description,
          row.repo_url, row.demo_url, row.video_url, row.tags, row.status, data.id, context.userId,
        ],
      );
      if (rows.length === 0) throw new Error("Project not found or not yours to edit.");
      id = (rows[0] as { id: string }).id;
    } else {
      const { rows } = await pool.query(
        `insert into public.submissions
           (event_id, track_id, owner_id, team_name, title, tagline, description, repo_url, demo_url, video_url, tags, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [
          row.event_id, row.track_id, row.owner_id, row.team_name, row.title, row.tagline,
          row.description, row.repo_url, row.demo_url, row.video_url, row.tags, row.status,
        ],
      );
      id = (rows[0] as { id: string }).id;
    }

    if (data.status === "submitted") {
      await logAudit({
        eventId: data.eventId,
        actor: context.userId,
        action: "submission.submitted",
        entity: "submissions",
        entityId: id,
      });
      const { triggerWebhooks } = await import("./mesh/webhooks");
      await triggerWebhooks("submission.submitted", { eventId: data.eventId, submissionId: id });
    }
    return { id };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await meshPool().query("delete from public.submissions where id = $1 and owner_id = $2", [
      data.id,
      context.userId,
    ]);
    return { ok: true };
  });

const mediaUrl = z.string().trim().url().max(500).optional().or(z.literal(""));
/**
 * Thumbnail + image gallery for a submission. Ownership is verified against
 * the submission row; bytes live in the media buddy-table.
 */
export const saveSubmissionMedia = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        submissionId: z.string().uuid(),
        thumbnailUrl: mediaUrl.default(""),
        images: z.array(mediaUrl).max(8).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { rows } = await meshPool().query(
      "select id from public.submissions where id = $1 and owner_id = $2",
      [data.submissionId, context.userId],
    );
    if (rows.length === 0) throw new Error("Project not found or not yours to edit.");
    const images = data.images.filter((url): url is string => Boolean(url));
    await meshPool().query(
      `insert into public.submission_media (submission_id, thumbnail_url, images, updated_at)
       values ($1, $2, $3, now())
       on conflict (submission_id)
       do update set thumbnail_url = excluded.thumbnail_url, images = excluded.images, updated_at = now()`,
      [data.submissionId, data.thumbnailUrl || "", images],
    );
    return { ok: true };
  });

const answerValue = z.string().trim().max(2000);

/**
 * Answers to the organizer's custom questions. Kind-checked per question;
 * required answers are enforced when submitting (`forSubmit: true`).
 */
export const saveSubmissionAnswers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        submissionId: z.string().uuid(),
        forSubmit: z.boolean().default(false),
        answers: z
          .array(z.object({ questionId: z.string().uuid(), value: answerValue.default("") }))
          .max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows: ownRows } = await pool.query(
      "select event_id from public.submissions where id = $1 and owner_id = $2",
      [data.submissionId, context.userId],
    );
    const own = ownRows[0] as { event_id: string } | undefined;
    if (!own) throw new Error("Project not found or not yours to edit.");

    const { rows: questionRows } = await pool.query(
      "select id, label, kind, required from public.custom_questions where event_id = $1",
      [own.event_id],
    );
    const questions = questionRows as { id: string; label: string; kind: string; required: boolean }[];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const given = new Map(data.answers.map((a) => [a.questionId, a.value]));

    for (const [questionId, value] of given) {
      const question = byId.get(questionId);
      if (!question) throw new Error("Unknown question.");
      if (question.kind === "url" && value && !/^https?:\/\/.+\..+/.test(value)) {
        throw new Error(`"${question.label}" must be a valid URL.`);
      }
      if (question.kind === "number" && value && Number.isNaN(Number(value))) {
        throw new Error(`"${question.label}" must be a number.`);
      }
      if (question.kind === "boolean" && value && value !== "true" && value !== "false") {
        throw new Error(`"${question.label}" must be true or false.`);
      }
    }
    if (data.forSubmit) {
      const missing = questions.filter((q) => q.required && !given.get(q.id)?.trim());
      if (missing.length > 0) {
        throw new Error(`Required question unanswered: "${missing[0]!.label}".`);
      }
    }

    for (const [questionId, value] of given) {
      await pool.query(
        `insert into public.submission_answers (submission_id, question_id, value, updated_at)
         values ($1, $2, $3, now())
         on conflict (submission_id, question_id)
         do update set value = excluded.value, updated_at = now()`,
        [data.submissionId, questionId, value],
      );
    }
    return { ok: true, saved: given.size };
  });

/** Roles for the signed-in user, used to decide which nav links to show. */
export const myAccess = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const pool = meshPool();
    const [rolesRes, judgesRes] = await Promise.all([
      pool.query("select role from public.user_roles where user_id = $1", [context.userId]),
      pool.query("select id from public.judges where user_id = $1", [context.userId]),
    ]);
    return {
      userId: context.userId,
      roles: (rolesRes.rows as { role: string }[]).map((r) => r.role),
      judgeIds: (judgesRes.rows as { id: string }[]).map((j) => j.id),
    };
  });

/**
 * First-run bootstrap: the first signed-in account can claim the organizer
 * role. Once an organizer exists, this does nothing.
 */
export const claimFirstOrganizer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const pool = meshPool();
    const { rows } = await pool.query(
      "select count(*) as count from public.user_roles where role = 'organizer'",
    );
    if (Number((rows[0] as { count: string }).count) > 0) {
      return { granted: false, reason: "An organizer already exists." };
    }
    await pool.query(
      "insert into public.user_roles (user_id, role) values ($1, 'organizer') on conflict (user_id, role) do nothing",
      [context.userId],
    );
    return { granted: true };
  });

async function hasRole(userId: string, role: string): Promise<boolean> {
  const { rows } = await meshPool().query(
    "select 1 from public.user_roles where user_id = $1 and role = $2",
    [userId, role],
  );
  return rows.length > 0;
}

/**
 * Audit receipt: everything behind this project's placing, so the team can
 * contest a specific input rather than "the algorithm".
 */
export const projectReceipt = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { submissionId: string }) =>
    z.object({ submissionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows } = await pool.query(
      "select id, event_id, title, team_name, owner_id, status from public.submissions where id = $1",
      [data.submissionId],
    );
    const submission = rows[0] as
      | { id: string; event_id: string; title: string; team_name: string; owner_id: string | null; status: string }
      | undefined;
    if (!submission) throw new Error("Project not found.");

    const isOwner = submission.owner_id === context.userId;
    const isOrganizer = await hasRole(context.userId, "organizer");
    if (!isOwner && !isOrganizer) throw new Error("Forbidden: this receipt belongs to another team.");

    // Reading every review of the event is required to compute calibration and
    // robustness; the caller only ever sees anonymised, aggregated output.
    const loaded = await loadEventReviews(submission.event_id);

    const certificate = certifyDecision({
      criteria: loaded.criteria,
      reviews: loaded.reviews,
      submissionIds: loaded.submissions.map((s) => s.id),
      minReviews: loaded.event.reviews_per_submission,
    });
    const normalized = normalizeScores({
      criteria: loaded.criteria,
      reviews: loaded.reviews,
      submissionIds: loaded.submissions.map((s) => s.id),
      minReviews: loaded.event.reviews_per_submission,
    });

    const project = certificate.projects.find((p) => p.submissionId === submission.id);
    if (!project) {
      return { submission, published: false as const };
    }

    const labels = anonymiseJudges(loaded.judges.map((j) => j.id));
    const statsByJudge = new Map(normalized.judgeStats.map((s) => [s.judgeId, s]));
    const myReviews = loaded.reviews
      .filter((r) => r.submissionId === submission.id)
      .map((review) => {
        const stats = statsByJudge.get(review.judgeId);
        return {
          judgeLabel: labels[review.judgeId] ?? "Judge",
          rawTotal: weightedTotal(review, loaded.criteria),
          judgeMean: stats?.mean ?? 0,
          judgeBias: stats?.bias ?? 0,
          judgeReviewCount: stats?.reviewCount ?? 0,
          perCriterion: loaded.criteria.map((criterion) => ({
            name: criterion.name ?? "Criterion",
            weight: criterion.weight,
            value: review.scores[criterion.id] ?? null,
          })),
        };
      })
      .sort((a, b) => a.judgeLabel.localeCompare(b.judgeLabel));

    return {
      submission,
      published: true as const,
      projectCount: certificate.projects.length,
      overallMean: normalized.overallMean,
      overallStdDev: normalized.overallStdDev,
      certificate: {
        overall: certificate.overall,
        rules: certificate.rules.map((rule) => ({
          rule: rule.rule,
          label: rule.label,
          rank: rule.ranks[submission.id] ?? null,
        })),
      },
      project,
      reviews: myReviews,
    };
  });

export type ProjectReceiptPayload = Awaited<ReturnType<typeof projectReceipt>>;
