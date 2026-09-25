import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth/require-auth";
import { evidenceSignal, evidenceSufficiencyIndex, evidenceTarget } from "./engine/evidence";
import type { ProjectManifest } from "./engine/manifest";
import { logAudit } from "./mesh/audit";
import { meshPool } from "./mesh/db";
import { organismComplexity, organismEvidenceComponents } from "./mesh/mesh.functions";
import { loadJudgeScopes } from "./mesh/scopes";

export type EvidenceStrip = {
  found: boolean;
  supported: number;
  partial: number;
  unverified: number;
  contradicted: number;
  replay: "passed" | "failed" | "none";
  signal: string;
};

/**
 * Per-submission evidence summary for judges. The mesh store is optional:
 * any failure yields an empty map and the console works exactly as before.
 */
async function evidenceStrips(submissionIds: string[]): Promise<Record<string, EvidenceStrip>> {
  const strips: Record<string, EvidenceStrip> = {};
  if (submissionIds.length === 0) return strips;
  try {
    const pool = meshPool();
    const { rows: manifests } = await pool.query(
      `select distinct on (submission_id) id, submission_id, manifest from public.organism_manifests
       where submission_id = any ($1) order by submission_id, created_at desc`,
      [submissionIds],
    );
    for (const manifest of manifests as { id: string; submission_id: string; manifest: ProjectManifest }[]) {
      const [claimRes, linkRes, artifactRes, runRes] = await Promise.all([
        pool.query("select claim_id, status from public.organism_claims where manifest_id = $1", [manifest.id]),
        pool.query("select claim_id from public.claim_links where manifest_id = $1", [manifest.id]),
        pool.query("select kind from public.evidence_artifacts where manifest_id = $1", [manifest.id]),
        pool.query(
          "select scenario_id, status from public.replay_runs where manifest_id = $1 order by created_at asc",
          [manifest.id],
        ),
      ]);
      const claims = claimRes.rows as { claim_id: string; status: string }[];
      const linkCounts = new Map<string, number>();
      for (const link of linkRes.rows as { claim_id: string }[]) {
        linkCounts.set(link.claim_id, (linkCounts.get(link.claim_id) ?? 0) + 1);
      }
      const runs = runRes.rows as { scenario_id: string; status: string }[];
      const components = organismEvidenceComponents({
        manifest: manifest.manifest,
        claims: claims.map((c) => ({ id: c.claim_id, links: linkCounts.get(c.claim_id) ?? 0 })),
        artifactKinds: (artifactRes.rows as { kind: string }[]).map((a) => a.kind),
        runs,
      });
      const sufficiency = evidenceSufficiencyIndex({
        test: components.test,
        replay: components.replay,
        docs: components.docs,
        security: components.security,
      });
      const signal = evidenceSignal(sufficiency, evidenceTarget(organismComplexity({ manifest: manifest.manifest })));
      const statuses = claims.map((c) => c.status);
      const latest = new Map<string, string>();
      for (const run of runs) latest.set(run.scenario_id, run.status);
      const states = [...latest.values()];
      strips[manifest.submission_id] = {
        found: true,
        supported: statuses.filter((s) => s === "SUPPORTED").length,
        partial: statuses.filter((s) => s === "PARTIAL").length,
        unverified: statuses.filter((s) => s === "UNVERIFIED").length,
        contradicted: statuses.filter((s) => s === "CONTRADICTED").length,
        replay: states.length === 0 ? "none" : states.every((s) => s === "passed") ? "passed" : "failed",
        signal,
      };
    }
  } catch {
    return strips;
  }
  return strips;
}

/** Everything the judge console needs: assignments, projects, criteria, saved scores. */
export const myQueue = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const pool = meshPool();
    const { rows: judgeRows } = await pool.query(
      "select id, display_name, event_id from public.judges where user_id = $1",
      [context.userId],
    );
    const judges = judgeRows as { id: string; display_name: string; event_id: string }[];
    if (judges.length === 0) return { judge: null, criteria: [], assignments: [], evidence: {} };
    const judge = judges[0]!;

    const [criteriaRes, assignmentsRes] = await Promise.all([
      pool.query(
        "select id, name, description, weight, min_score, max_score, position from public.criteria where event_id = $1 order by position",
        [judge.event_id],
      ),
      pool.query(
        `select a.id, a.status, a.comment, a.submitted_at, a.submission_id, a.targeted,
                s.id as s_id, s.title, s.tagline, s.team_name, s.description, s.repo_url, s.demo_url,
                s.video_url, s.tags, t.name as track_name
         from public.assignments a
         join public.submissions s on s.id = a.submission_id
         left join public.tracks t on t.id = s.track_id
         where a.judge_id = $1
         order by a.targeted desc, a.created_at asc`,
        [judge.id],
      ),
    ]);

    type AssignmentRow = {
      id: string;
      status: string;
      comment: string | null;
      submitted_at: Date | string | null;
      submission_id: string;
      targeted: boolean;
      s_id: string;
      title: string;
      tagline: string | null;
      team_name: string;
      description: string | null;
      repo_url: string | null;
      demo_url: string | null;
      video_url: string | null;
      tags: string[];
      track_name: string | null;
    };

    // Track isolation, enforced in the backend: a scoped judge never sees
    // assignments outside their track, even if one was created earlier.
    let visible = assignmentsRes.rows as AssignmentRow[];
    const scopes = await loadJudgeScopes([judge.id]);
    const scope = scopes[judge.id];
    if (scope) {
      const { rows: trackRows } = await pool.query(
        "select id, track_id from public.submissions where id = any ($1)",
        [visible.map((a) => a.submission_id)],
      );
      const trackById = new Map(
        (trackRows as { id: string; track_id: string | null }[]).map((s) => [s.id, s.track_id]),
      );
      visible = visible.filter((a) => trackById.get(a.submission_id) === scope);
    }

    const assignmentIds = visible.map((a) => a.id);
    let scoreRows: { assignment_id: string; criterion_id: string; value: string | number }[] = [];
    if (assignmentIds.length > 0) {
      const { rows } = await pool.query(
        "select assignment_id, criterion_id, value from public.scores where assignment_id = any ($1)",
        [assignmentIds],
      );
      scoreRows = rows as typeof scoreRows;
    }

    return {
      judge: { id: judge.id, display_name: judge.display_name, event_id: judge.event_id },
      criteria: (criteriaRes.rows as Record<string, unknown>[]).map((c) => ({
        id: c["id"] as string,
        name: c["name"] as string,
        description: (c["description"] as string | null) ?? null,
        weight: Number(c["weight"]),
        min_score: c["min_score"] as number,
        max_score: c["max_score"] as number,
        position: c["position"] as number,
      })),
      assignments: visible.map((a) => ({
        id: a.id,
        status: a.status,
        comment: a.comment,
        submitted_at: a.submitted_at,
        submission_id: a.submission_id,
        targeted: a.targeted,
        submissions: {
          id: a.s_id,
          title: a.title,
          tagline: a.tagline,
          team_name: a.team_name,
          description: a.description,
          repo_url: a.repo_url,
          demo_url: a.demo_url,
          video_url: a.video_url,
          tags: a.tags ?? [],
          tracks: a.track_name ? { name: a.track_name } : null,
        },
        scores: scoreRows
          .filter((s) => s.assignment_id === a.id)
          .map((s) => ({ criterionId: s.criterion_id, value: Number(s.value) })),
      })),
      evidence: await evidenceStrips(visible.map((a) => a.submission_id)),
    };
  });

export const reviewSchema = z.object({
  assignmentId: z.string().uuid(),
  comment: z.string().trim().max(2000).optional(),
  submit: z.boolean().default(false),
  scores: z
    .array(z.object({ criterionId: z.string().uuid(), value: z.number().min(0).max(100) }))
    .max(50),
});

export const saveReview = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => reviewSchema.parse(input))
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    // Ownership is checked in SQL: the row must belong to a judge of this user.
    const { rows } = await pool.query(
      `select a.id, a.event_id, a.judge_id, a.submission_id from public.assignments a
       join public.judges j on j.id = a.judge_id
       where a.id = $1 and j.user_id = $2`,
      [data.assignmentId, context.userId],
    );
    const assignment = rows[0] as
      | { id: string; event_id: string; judge_id: string; submission_id: string }
      | undefined;
    if (!assignment) throw new Error("This review is not assigned to you.");

    // Track scope holds on write too, not just on listing.
    const writeScopes = await loadJudgeScopes([assignment.judge_id]);
    const writeScope = writeScopes[assignment.judge_id];
    if (writeScope) {
      const { rows: subRows } = await pool.query(
        "select track_id from public.submissions where id = $1",
        [assignment.submission_id],
      );
      const trackId = (subRows[0] as { track_id: string | null } | undefined)?.track_id ?? null;
      if (trackId !== writeScope) throw new Error("Forbidden: this project is outside your track.");
    }

    const { rows: criteria } = await pool.query(
      "select id, min_score, max_score from public.criteria where event_id = $1",
      [assignment.event_id],
    );
    const byId = new Map(
      (criteria as { id: string; min_score: number; max_score: number }[]).map((c) => [c.id, c]),
    );
    for (const score of data.scores) {
      const criterion = byId.get(score.criterionId);
      if (!criterion) throw new Error("Unknown scoring criterion.");
      if (score.value < criterion.min_score || score.value > criterion.max_score) {
        throw new Error(`Scores must be between ${criterion.min_score} and ${criterion.max_score}.`);
      }
    }

    if (data.submit && data.scores.length !== criteria.length) {
      throw new Error("Score every criterion before submitting the review.");
    }

    if (data.scores.length > 0) {
      const values = data.scores
        .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
        .join(", ");
      await pool.query(
        `insert into public.scores (assignment_id, criterion_id, value) values ${values}
         on conflict (assignment_id, criterion_id)
         do update set value = excluded.value, updated_at = now()`,
        data.scores.flatMap((s) => [data.assignmentId, s.criterionId, s.value]),
      );
    }

    await pool.query(
      "update public.assignments set comment = $1, status = $2, submitted_at = $3 where id = $4",
      [data.comment || null, data.submit ? "submitted" : "draft", data.submit ? new Date().toISOString() : null, data.assignmentId],
    );

    if (data.submit) {
      await logAudit({
        eventId: assignment.event_id,
        actor: context.userId,
        action: "review.submitted",
        entity: "assignments",
        entityId: data.assignmentId,
      });
      const { triggerWebhooks } = await import("./mesh/webhooks");
      await triggerWebhooks("review.submitted", {
        eventId: assignment.event_id,
        assignmentId: data.assignmentId,
        submissionId: assignment.submission_id,
      });
    }
    return { ok: true, status: data.submit ? "submitted" : "draft" };
  });
