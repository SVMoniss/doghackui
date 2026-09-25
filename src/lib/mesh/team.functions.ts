import { randomBytes } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "../auth/require-auth";

import { meshPool } from "./db";

const uuid = z.string().uuid();

async function isMember(teamId: string, userId: string): Promise<boolean> {
  const { rows } = await meshPool().query(
    "select 1 from public.team_members where team_id = $1 and user_key = $2",
    [teamId, userId],
  );
  return rows.length > 0;
}

/** Teams the signed-in user belongs to, with member counts. */
export const myTeams = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { rows } = await meshPool().query(
      `select t.id, t.event_id, t.name, t.created_at,
              (select count(*) from public.team_members m where m.team_id = t.id) as members,
              (select m2.role from public.team_members m2 where m2.team_id = t.id and m2.user_key = $1) as my_role
       from public.teams t
       join public.team_members m on m.team_id = t.id and m.user_key = $1
       order by t.created_at desc`,
      [context.userId],
    );
    return rows as {
      id: string;
      event_id: string;
      name: string;
      created_at: string;
      members: string;
      my_role: string;
    }[];
  });

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ eventId: uuid, name: z.string().trim().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows } = await pool.query(
      "insert into public.teams (event_id, name, created_by) values ($1, $2, $3) returning id",
      [data.eventId, data.name, context.userId],
    );
    const teamId = (rows[0] as { id: string }).id;
    await pool.query(
      "insert into public.team_members (team_id, user_key, role) values ($1, $2, 'owner')",
      [teamId, context.userId],
    );
    return { id: teamId };
  });

export const teamInvites = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { teamId: string }) => z.object({ teamId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isMember(data.teamId, context.userId))) throw new Error("Forbidden: not a team member.");
    const { rows } = await meshPool().query(
      "select id, token, revoked, uses, max_uses, expires_at, created_at from public.team_invites where team_id = $1 order by created_at desc",
      [data.teamId],
    );
    return rows;
  });

/** Mint a high-entropy invite link (revocable, 30-day expiry). */
export const inviteToTeam = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ teamId: uuid, maxUses: z.number().int().min(0).max(100).default(0) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isMember(data.teamId, context.userId))) throw new Error("Forbidden: not a team member.");
    const token = randomBytes(24).toString("base64url");
    const { rows } = await meshPool().query(
      `insert into public.team_invites (team_id, token, created_by, expires_at, max_uses)
       values ($1, $2, $3, now() + interval '30 days', $4)
       returning id, token`,
      [data.teamId, token, context.userId, data.maxUses],
    );
    return rows[0] as { id: string; token: string };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ inviteId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows } = await pool.query("select team_id from public.team_invites where id = $1", [data.inviteId]);
    const invite = rows[0] as { team_id: string } | undefined;
    if (!invite) throw new Error("Invite not found.");
    if (!(await isMember(invite.team_id, context.userId))) throw new Error("Forbidden: not a team member.");
    await pool.query("update public.team_invites set revoked = true where id = $1", [data.inviteId]);
    return { ok: true };
  });

/** Join a team through an invite link. Validates expiry, revocation, and use caps. */
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows } = await pool.query(
      "select ti.team_id, ti.revoked, ti.uses, ti.max_uses, ti.expires_at, t.name as team_name from public.team_invites ti join public.teams t on t.id = ti.team_id where ti.token = $1",
      [data.token],
    );
    const invite = rows[0] as
      | { team_id: string; revoked: boolean; uses: number; max_uses: number; expires_at: string | null; team_name: string }
      | undefined;
    if (!invite) throw new Error("Invite not found.");
    if (invite.revoked) throw new Error("This invite was revoked.");
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      throw new Error("This invite has expired.");
    }
    if (invite.max_uses > 0 && invite.uses >= invite.max_uses) {
      throw new Error("This invite has been used up.");
    }
    await pool.query(
      `insert into public.team_members (team_id, user_key, role) values ($1, $2, 'member')
       on conflict (team_id, user_key) do nothing`,
      [invite.team_id, context.userId],
    );
    await pool.query("update public.team_invites set uses = uses + 1 where token = $1", [data.token]);
    return { teamId: invite.team_id, teamName: invite.team_name };
  });
