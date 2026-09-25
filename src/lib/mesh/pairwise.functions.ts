import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "../auth/require-auth";
import { fitBradleyTerry, type PairwiseCount } from "../engine/aggregate";
import { logAudit } from "./audit";
import { meshPool } from "./db";

const uuid = z.string().uuid();

async function voterRoles(userId: string): Promise<string[]> {
  const { rows } = await meshPool().query("select role from public.user_roles where user_id = $1", [userId]);
  return (rows as { role: string }[]).map((r) => r.role);
}

/**
 * Draw two eligible projects for a head-to-head pick: submitted, same event,
 * not owned by the voter, no declared conflict through any of their judge rows.
 */
export const pairwisePair = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const roles = await voterRoles(context.userId);
    if (!roles.some((r) => ["judge", "organizer", "admin"].includes(r))) {
      throw new Error("Forbidden: judges only.");
    }
    const pool = meshPool();
    const { rows } = await pool.query(
      `select s.id, s.title, s.tagline, s.team_name from public.submissions s
       where s.event_id = $1 and s.status = 'submitted'
         and (s.owner_id is null or s.owner_id <> $2)
         and not exists (
           select 1 from public.conflicts c join public.judges j on j.id = c.judge_id
           where c.submission_id = s.id and j.user_id = $2
         )
       order by random() limit 2`,
      [data.eventId, context.userId],
    );
    const pair = rows as { id: string; title: string; tagline: string | null; team_name: string }[];
    if (pair.length < 2) return { pair: [] as typeof pair };
    return { pair };
  });

export const castPairwiseVote = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: uuid, winnerId: uuid, loserId: uuid }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const roles = await voterRoles(context.userId);
    if (!roles.some((r) => ["judge", "organizer", "admin"].includes(r))) {
      throw new Error("Forbidden: judges only.");
    }
    if (data.winnerId === data.loserId) throw new Error("Pick two different projects.");
    const pool = meshPool();
    const { rows } = await pool.query(
      `select id, owner_id from public.submissions
       where event_id = $1 and status = 'submitted' and id = any ($2)`,
      [data.eventId, [data.winnerId, data.loserId]],
    );
    if (rows.length !== 2) throw new Error("Both projects must be submitted in this event.");
    for (const row of rows as { id: string; owner_id: string | null }[]) {
      if (row.owner_id === context.userId) throw new Error("You cannot vote on your own project.");
    }
    await pool.query(
      "insert into public.pairwise_votes (event_id, voter_key, winner_id, loser_id) values ($1, $2, $3, $4)",
      [data.eventId, context.userId, data.winnerId, data.loserId],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "pairwise.voted",
      entity: "submissions",
      entityId: `${data.winnerId}>${data.loserId}`,
    });
    return { ok: true };
  });

/**
 * Global ranking from explicit pairwise votes (Bradley-Terry MM, same
 * estimator the aggregate engine uses for induced pairs).
 */
export const pairwiseRanking = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const roles = await voterRoles(context.userId);
    if (!roles.some((r) => ["organizer", "admin"].includes(r))) {
      throw new Error("Forbidden: organizers only.");
    }
    const pool = meshPool();
    const [{ rows: voteRows }, { rows: subRows }] = await Promise.all([
      pool.query("select winner_id, loser_id from public.pairwise_votes where event_id = $1", [data.eventId]),
      pool.query("select id, title, team_name from public.submissions where event_id = $1 and status = 'submitted'", [
        data.eventId,
      ]),
    ]);
    const ids = (subRows as { id: string }[]).map((s) => s.id).sort();
    const pairs: PairwiseCount[] = (voteRows as { winner_id: string; loser_id: string }[]).map((v) => ({
      winner: v.winner_id,
      loser: v.loser_id,
      weight: 1,
    }));
    const strengths = fitBradleyTerry(pairs, ids);
    const wins = new Map<string, number>();
    for (const v of voteRows as { winner_id: string; loser_id: string }[]) {
      wins.set(v.winner_id, (wins.get(v.winner_id) ?? 0) + 1);
    }
    const titles = Object.fromEntries(
      (subRows as { id: string; title: string; team_name: string }[]).map((s) => [s.id, s]),
    );
    const order = ids.slice().sort((a, b) => (strengths[b] ?? 0) - (strengths[a] ?? 0) || a.localeCompare(b));
    return {
      totalVotes: (voteRows as unknown[]).length,
      connected: (voteRows as unknown[]).length > 0,
      ranking: order.map((id, index) => ({
        rank: index + 1,
        submissionId: id,
        title: (titles[id] as { title: string; team_name: string } | undefined)?.title ?? "Unknown",
        teamName: (titles[id] as { title: string; team_name: string } | undefined)?.team_name ?? "—",
        strength: Math.round((strengths[id] ?? 0) * 1000) / 1000,
        wins: wins.get(id) ?? 0,
      })),
    };
  });
