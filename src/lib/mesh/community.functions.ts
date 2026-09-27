import { createHash } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "../auth/require-auth";
import { logAudit } from "./audit";
import { meshPool } from "./db";

const uuid = z.string().uuid();

export type VotingMode = "off" | "one_person_one_vote" | "quadratic";

export type VotingConfig = {
  mode: VotingMode;
  open: boolean;
  published: boolean;
};

export async function getVotingConfig(eventId: string): Promise<VotingConfig> {
  const { rows } = await meshPool().query(
    "select voting_mode, voting_open, results_published from public.events where id = $1",
    [eventId],
  );
  const row = rows[0] as
    | { voting_mode: VotingMode; voting_open: boolean; results_published: boolean }
    | undefined;
  if (!row) throw new Error("Event not found.");
  return { mode: row.voting_mode, open: row.voting_open, published: row.results_published };
}

async function isOrganizer(userId: string): Promise<boolean> {
  const { rows } = await meshPool().query(
    "select 1 from public.user_roles where user_id = $1 and role in ('organizer', 'admin')",
    [userId],
  );
  return rows.length > 0;
}

async function assertOrganizer(userId: string): Promise<void> {
  if (!(await isOrganizer(userId))) throw new Error("Forbidden: organizer role required.");
}

/** Public voting configuration for an event. */
export const votingConfig = createServerFn({ method: "GET" })
  .inputValidator((input: { eventId: string }) => z.object({ eventId: uuid }).parse(input))
  .handler(async ({ data }) => getVotingConfig(data.eventId));

export const setVoting = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: uuid,
        mode: z.enum(["off", "one_person_one_vote", "quadratic"]),
        open: z.boolean(),
        published: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context.userId);
    const previous = await getVotingConfig(data.eventId).catch(() => null);
    await meshPool().query(
      "update public.events set voting_mode = $1, voting_open = $2, results_published = $3 where id = $4",
      [data.mode, data.open, data.published, data.eventId],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "voting.configured",
      entity: "events",
      entityId: data.eventId,
      detail: { mode: data.mode, open: data.open, published: data.published },
    });
    if (data.published && !previous?.published) {
      const { triggerWebhooks } = await import("./webhooks");
      await triggerWebhooks("voting.published", { eventId: data.eventId });
    }
    return { ok: true };
  });

export function emailVoterKey(email: string): string {
  return `email:${createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex").slice(0, 32)}`;
}

/** Deterministic per-voter shuffle: kills position bias without stored state. */
export function shuffleForVoter(ids: string[], seedKey: string, eventId: string): string[] {
  return ids
    .slice()
    .sort((a, b) =>
      createHash("sha256")
        .update(`${seedKey}:${eventId}:${a}`, "utf8")
        .digest("hex")
        .localeCompare(createHash("sha256").update(`${seedKey}:${eventId}:${b}`, "utf8").digest("hex")),
    );
}

/**
 * Ballot for the caller: submitted projects in voter-seeded random order
 * (kills position bias without storing per-voter state), plus the caller's
 * existing votes. Results stay hidden unless published or organizer.
 */
export const ballot = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const config = await getVotingConfig(data.eventId);
    const pool = meshPool();
    const { rows } = await pool.query(
      `select s.id, s.title, s.tagline, s.team_name, t.name as track_name
       from public.submissions s left join public.tracks t on t.id = s.track_id
       where s.event_id = $1 and s.status = 'submitted'`,
      [data.eventId],
    );
    const orderedIds = shuffleForVoter(
      (rows as { id: string }[]).map((r) => r.id),
      context.userId,
      data.eventId,
    );
    const byId = new Map((rows as Record<string, unknown>[]).map((r) => [r["id"] as string, r]));
    const { rows: mine } = await pool.query(
      "select submission_id, votes from public.votes where event_id = $1 and voter_key = $2",
      [data.eventId, context.userId],
    );
    const myVotes = Object.fromEntries(
      (mine as { submission_id: string; votes: number }[]).map((v) => [v.submission_id, v.votes]),
    );
    return {
      config,
      projects: orderedIds.map((id) => byId.get(id)),
      myVotes,
    };
  });

const VOTES_PER_HOUR_CAP = 30;

/**
 * Cast community votes. Rate-limited (30 vote-rows/hour/voter), duplicates
 * collapsed by unique(event, submission, voter). Never touches judge scores.
 */
export const castVote = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: uuid,
        submissionId: uuid,
        votes: z.number().int().min(1).max(5).default(1),
        voterEmail: z.string().trim().email().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const config = await getVotingConfig(data.eventId);
    if (config.mode === "off" || !config.open) throw new Error("Voting is not open.");
    // Email-gated mode for signed-out-adjacent flows: a voter may attribute
    // votes to an email instead of their account (hashed at rest).
    const voterKey = data.voterEmail ? emailVoterKey(data.voterEmail) : context.userId;
    const pool = meshPool();
    const { rows: subRows } = await pool.query(
      "select id from public.submissions where id = $1 and event_id = $2 and status = 'submitted'",
      [data.submissionId, data.eventId],
    );
    if (subRows.length === 0) throw new Error("Project not found or not submitted.");
    const { rows: recent } = await pool.query(
      `select count(*) as count from public.votes
       where event_id = $1 and voter_key = $2 and created_at > now() - interval '1 hour'`,
      [data.eventId, voterKey],
    );
    if (Number((recent[0] as { count: string }).count) >= VOTES_PER_HOUR_CAP) {
      throw new Error("Rate limit: too many votes this hour. Slow down.");
    }
    const votes = config.mode === "quadratic" ? data.votes : 1;
    await pool.query(
      `insert into public.votes (event_id, submission_id, voter_key, votes, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (event_id, submission_id, voter_key)
       do update set votes = excluded.votes, updated_at = now()`,
      [data.eventId, data.submissionId, voterKey, votes],
    );
    return { ok: true, votes };
  });

/**
 * Community standings. Hidden from everyone but organizers until published —
 * then ordered by tally (count, or sqrt-sum in quadratic mode).
 */
export const standings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const config = await getVotingConfig(data.eventId);
    const organizer = await isOrganizer(context.userId);
    if (!config.published && !organizer) {
      return { published: false as const, config };
    }
    const { rows } = await meshPool().query(
      `select v.submission_id, s.title, s.team_name,
              count(*) as ballots,
              case when $2 = 'quadratic' then sum(sqrt(v.votes::float)) else sum(v.votes) end as tally
       from public.votes v join public.submissions s on s.id = v.submission_id
       where v.event_id = $1 group by v.submission_id, s.title, s.team_name
       order by tally desc`,
      [data.eventId, config.mode],
    );
    return {
      published: true as const,
      config,
      standings: (rows as { submission_id: string; title: string; team_name: string; ballots: string; tally: string }[]).map(
        (r) => ({
          submissionId: r.submission_id,
          title: r.title,
          teamName: r.team_name,
          ballots: Number(r.ballots),
          tally: Math.round(Number(r.tally) * 100) / 100,
        }),
      ),
    };
  });

/** Public comments for a project (hidden ones excluded). */
export const listComments = createServerFn({ method: "GET" })
  .inputValidator((input: { submissionId: string }) => z.object({ submissionId: uuid }).parse(input))
  .handler(async ({ data }) => {
    const { rows } = await meshPool().query(
      `select c.id, c.body, c.created_at, coalesce(u.display_name, 'Community') as author
       from public.comments c left join public.users u on u.id::text = c.author_key
       where c.submission_id = $1 and c.hidden = false order by c.created_at asc limit 100`,
      [data.submissionId],
    );
    return rows as { id: string; body: string; created_at: string; author: string }[];
  });

export const postComment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ submissionId: uuid, body: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows: recent } = await pool.query(
      `select count(*) as count from public.comments
       where author_key = $1 and created_at > now() - interval '1 hour'`,
      [context.userId],
    );
    if (Number((recent[0] as { count: string }).count) >= 10) {
      throw new Error("Rate limit: too many comments this hour.");
    }
    const { rows: sub } = await pool.query(
      "select event_id from public.submissions where id = $1 and status = 'submitted'",
      [data.submissionId],
    );
    if (sub.length === 0) throw new Error("Project not found.");
    const { rows } = await pool.query(
      "insert into public.comments (event_id, submission_id, author_key, body) values ($1, $2, $3, $4) returning id",
      [(sub[0] as { event_id: string }).event_id, data.submissionId, context.userId, data.body],
    );
    return { id: (rows[0] as { id: string }).id };
  });

export const hideComment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ commentId: uuid, hidden: z.boolean().default(true) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context.userId);
    await meshPool().query("update public.comments set hidden = $1 where id = $2", [
      data.hidden,
      data.commentId,
    ]);
    await logAudit({
      actor: context.userId,
      action: data.hidden ? "comment.hidden" : "comment.unhidden",
      entity: "comments",
      entityId: data.commentId,
    });
    return { ok: true };
  });

async function validToken(eventId: string, token: string): Promise<boolean> {
  const { rows } = await meshPool().query(
    "select 1 from public.ballot_tokens where event_id = $1 and token = $2 and revoked = false",
    [eventId, token],
  );
  return rows.length > 0;
}

const tokenKey = (token: string) => `token:${token}`;

/** Organizer mints anonymous ballot tokens (shown once, bearer by design). */
export const createBallotTokens = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: uuid, count: z.number().int().min(1).max(100).default(10), label: z.string().trim().max(80).default("") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOrganizer(context.userId);
    const { randomBytes } = await import("node:crypto");
    const pool = meshPool();
    const tokens: string[] = [];
    for (let i = 0; i < data.count; i += 1) {
      const token = `blt_${randomBytes(16).toString("hex")}`;
      await pool.query("insert into public.ballot_tokens (token, event_id, label) values ($1, $2, $3)", [
        token,
        data.eventId,
        data.label,
      ]);
      tokens.push(token);
    }
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "ballot.tokens_created",
      entity: "events",
      entityId: data.eventId,
      detail: { count: tokens.length },
    });
    return { tokens };
  });

export const listBallotTokens = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { eventId: string }) => z.object({ eventId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context.userId);
    const { rows } = await meshPool().query(
      `select t.token, t.label, t.revoked, t.created_at,
              (select count(*) from public.votes v where v.event_id = t.event_id and v.voter_key = ('token:' || t.token)) as ballots
       from public.ballot_tokens t where t.event_id = $1 order by t.created_at desc limit 100`,
      [data.eventId],
    );
    return rows as { token: string; label: string; revoked: boolean; created_at: string; ballots: string }[];
  });

export const revokeBallotToken = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOrganizer(context.userId);
    await meshPool().query("update public.ballot_tokens set revoked = true where token = $1", [data.token]);
    return { ok: true };
  });

/** Anonymous ballot: same projects, token-seeded order, no session needed. */
export const tokenBallot = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ eventId: uuid, token: z.string().min(8).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const config = await getVotingConfig(data.eventId);
    if (!(await validToken(data.eventId, data.token))) throw new Error("Invalid or revoked ballot token.");
    const pool = meshPool();
    const { rows } = await pool.query(
      `select s.id, s.title, s.tagline, s.team_name from public.submissions s
       where s.event_id = $1 and s.status = 'submitted'`,
      [data.eventId],
    );
    const orderedIds = shuffleForVoter(
      (rows as { id: string }[]).map((r) => r.id),
      tokenKey(data.token),
      data.eventId,
    );
    const byId = new Map((rows as Record<string, unknown>[]).map((r) => [r["id"] as string, r]));
    const { rows: mine } = await pool.query(
      "select submission_id, votes from public.votes where event_id = $1 and voter_key = $2",
      [data.eventId, tokenKey(data.token)],
    );
    return {
      config,
      projects: orderedIds.map((id) => byId.get(id)),
      myVotes: Object.fromEntries(
        (mine as { submission_id: string; votes: number }[]).map((v) => [v.submission_id, v.votes]),
      ),
    };
  });

/** Anonymous vote through a ballot token. Same caps as authenticated votes. */
export const castTokenVote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ eventId: uuid, token: z.string().min(8).max(200), submissionId: uuid, votes: z.number().int().min(1).max(5).default(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const config = await getVotingConfig(data.eventId);
    if (config.mode === "off" || !config.open) throw new Error("Voting is not open.");
    if (!(await validToken(data.eventId, data.token))) throw new Error("Invalid or revoked ballot token.");
    const voterKey = tokenKey(data.token);
    const pool = meshPool();
    const { rows: subRows } = await pool.query(
      "select id from public.submissions where id = $1 and event_id = $2 and status = 'submitted'",
      [data.submissionId, data.eventId],
    );
    if (subRows.length === 0) throw new Error("Project not found or not submitted.");
    const { rows: recent } = await pool.query(
      "select count(*) as count from public.votes where event_id = $1 and voter_key = $2 and created_at > now() - interval '1 hour'",
      [data.eventId, voterKey],
    );
    if (Number((recent[0] as { count: string }).count) >= 30) {
      throw new Error("Rate limit: too many votes this hour.");
    }
    const votes = config.mode === "quadratic" ? data.votes : 1;
    await pool.query(
      `insert into public.votes (event_id, submission_id, voter_key, votes, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (event_id, submission_id, voter_key) do update set votes = excluded.votes, updated_at = now()`,
      [data.eventId, data.submissionId, voterKey, votes],
    );
    return { ok: true, votes };
  });
