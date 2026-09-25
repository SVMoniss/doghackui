/**
 * Local session client: talks to /api/auth/* (same origin, cookies included).
 * No hosted identity involved — fully offline-capable.
 */

export type AuthUser = { id: string; email: string; displayName: string | null };

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "Something went wrong");
  return payload;
}

export function signUp(input: { email: string; password: string }): Promise<{ user: AuthUser }> {
  return post("/api/auth/signup", input);
}

export function signIn(input: { email: string; password: string }): Promise<{ user: AuthUser }> {
  return post("/api/auth/signin", input);
}

export async function signOut(): Promise<void> {
  await post("/api/auth/signout", {});
}

export async function fetchMe(): Promise<{ user: AuthUser | null }> {
  const response = await fetch("/api/auth/me");
  if (!response.ok) return { user: null };
  return (await response.json()) as { user: AuthUser | null };
}
