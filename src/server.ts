import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import {
  clearSessionCookieHeader,
  createSession,
  destroySession,
  getSessionToken,
  getSessionUser,
  SESSION_TTL_MS,
  sessionCookieHeader,
} from "./lib/auth/session-store";
import { hashPassword, validateEmail, validatePassword, verifyPassword } from "./lib/auth/password";
import { RUBRIC_VERSION } from "./lib/engine/scoring";
import { renderErrorPage } from "./lib/error-page";

export const ALGORITHM_VERSION = "aggregate-v1:rawAverage+calibrated+bradleyTerry+borda+robustness-v1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function checkPostgres(timeoutMs = 2000): Promise<"up" | "down" | "unconfigured"> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) return "unconfigured";
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString, connectionTimeoutMillis: timeoutMs });
    try {
      await pool.query("select 1");
      return "up";
    } finally {
      await pool.end();
    }
  } catch {
    return "down";
  }
}

/**
 * Operational health endpoints (acceptance §13). Answered here — before the
 * TanStack router — so they stay fast, dependency-light, and stable.
 */
async function handleHealth(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/health/live") {
    return json({ status: "ok", time: new Date().toISOString() });
  }
  if (pathname === "/health/ready") {
    const postgres = await checkPostgres();
    return json({
      status: postgres === "down" ? "degraded" : "ready",
      postgres,
      seedDemo: process.env["OPENJUDGE_SEED_DEMO"] ?? "true",
      time: new Date().toISOString(),
    });
  }
  if (pathname === "/health/version") {
    return json({
      app: "openjudge",
      rubric: RUBRIC_VERSION,
      algorithms: ALGORITHM_VERSION,
      node: process.version,
    });
  }
  if (pathname.startsWith("/api/auth/")) {
    return handleAuth(request);
  }
  if (pathname.startsWith("/api/")) {
    const { handleApi } = await import("./lib/api/rest");
    return handleApi(request);
  }
  return null;
}

/** Local auth API: signup/signin/signout/me against self-host Postgres. */
async function handleAuth(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const { meshPool } = await import("./lib/mesh/db");
  const wantsJson = request.method === "POST" || pathname === "/api/auth/me";

  if (request.method === "GET" && pathname === "/api/auth/me") {
    const token = getSessionToken(request);
    const user = token ? await getSessionUser(token).catch(() => null) : null;
    return json({ user });
  }

  if (request.method !== "POST" || !wantsJson) return null;

  // Same-origin POSTs only (cookie-based sessions; Lax + this check).
  const host = new URL(request.url).host;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const originOk = origin
    ? safeHost(origin) === host
    : referer
      ? safeHost(referer) === host
      : true;
  if (!originOk) return json({ error: "Cross-origin requests are not allowed." }, 403);

  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const secure = new URL(request.url).protocol === "https:";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  if (pathname === "/api/auth/signout") {
    const token = getSessionToken(request);
    if (token) await destroySession(token);
    const response = json({ ok: true });
    response.headers.set("Set-Cookie", clearSessionCookieHeader());
    return response;
  }

  const email = (body?.email ?? "").trim().toLowerCase();
  const password = body?.password ?? "";
  const emailError = validateEmail(email);
  if (emailError) return json({ error: emailError }, 400);
  const passwordError = validatePassword(password);
  if (passwordError) return json({ error: passwordError }, 400);

  if (pathname === "/api/auth/signup") {
    const existing = await meshPool()
      .query("select id from public.users where email = $1", [email])
      .catch(() => null);
    if (!existing) return json({ error: "Database unavailable. Is Postgres running?" }, 503);
    if ((existing.rows as unknown[]).length > 0) {
      return json({ error: "An account with this email already exists." }, 400);
    }
    const { rows } = await meshPool().query(
      "insert into public.users (email, password_hash, display_name) values ($1, $2, $3) returning id",
      [email, hashPassword(password), email.split("@")[0]],
    );
    const userId = (rows[0] as { id: string }).id;
    await meshPool().query("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [
      userId,
      email,
    ]);
    // New accounts participate by default; link any pre-created judge row.
    await meshPool().query(
      "insert into public.user_roles (user_id, role) values ($1, 'participant') on conflict (user_id, role) do nothing",
      [userId],
    );
    const linked = await meshPool().query(
      "update public.judges set user_id = $1 where email = $2 and user_id is null returning id",
      [userId, email],
    );
    if ((linked.rows as unknown[]).length > 0) {
      await meshPool().query(
        "insert into public.user_roles (user_id, role) values ($1, 'judge') on conflict (user_id, role) do nothing",
        [userId],
      );
    }
    const { token } = await createSession(userId);
    const response = json({ ok: true, user: { id: userId, email, displayName: email.split("@")[0] } });
    response.headers.set("Set-Cookie", sessionCookieHeader(token, secure, maxAge));
    return response;
  }

  if (pathname === "/api/auth/signin") {
    const found = await meshPool()
      .query("select id, email, password_hash, display_name from public.users where email = $1", [email])
      .catch(() => null);
    if (!found) return json({ error: "Database unavailable. Is Postgres running?" }, 503);
    const row = (found.rows as { id: string; email: string; password_hash: string | null; display_name: string | null }[])[0];
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
      return json({ error: "Invalid email or password." }, 401);
    }
    const { token } = await createSession(row.id);
    const response = json({ ok: true, user: { id: row.id, email: row.email, displayName: row.display_name } });
    response.headers.set("Set-Cookie", sessionCookieHeader(token, secure, maxAge));
    return response;
  }

  return null;
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const health = await handleHealth(request);
      if (health) return health;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
