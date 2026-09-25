/**
 * Server-side session store (self-host Postgres). Tokens are opaque 256-bit
 * values; only their sha256 is persisted. 30-day expiry, sliding not needed.
 */

import { createHash, randomBytes } from "node:crypto";

import { meshPool } from "../mesh/db";

export const SESSION_COOKIE = "oj_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; email: string; displayName: string | null };

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = mintToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await meshPool().query(
    "insert into public.sessions (user_id, token_hash, expires_at) values ($1, $2, $3)",
    [userId, hashToken(token), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  try {
    const { rows } = await meshPool().query(
      `select u.id, u.email, u.display_name from public.sessions s
       join public.users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [hashToken(token)],
    );
    const row = rows[0] as { id: string; email: string; display_name: string | null } | undefined;
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.display_name };
  } catch {
    return null;
  }
}

export async function destroySession(token: string): Promise<void> {
  try {
    await meshPool().query("delete from public.sessions where token_hash = $1", [hashToken(token)]);
  } catch {
    // Logout must succeed even if the store hiccups; the cookie is cleared anyway.
  }
}

export async function destroyUserSessions(userId: string): Promise<void> {
  try {
    await meshPool().query("delete from public.sessions where user_id = $1", [userId]);
  } catch {
    // Best effort.
  }
}

/** Read our session cookie off a request without framework helpers. */
export function getSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sessionCookieHeader(token: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
