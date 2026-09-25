/**
 * Creates local demo accounts (organizer, judge, participant) for hands-on
 * testing. Passwords come from the environment — never committed.
 *
 * Usage:
 *   OJ_DEMO_PASSWORD='a-strong-password' npx tsx mesh/seed-accounts.ts
 *
 * The first account can also just sign up in the UI and claim the organizer
 * role from the dashboard; this script is a shortcut for local demos.
 */
import { Pool } from "pg";

import { hashPassword, validatePassword } from "../src/lib/auth/password";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function ensureUser(email: string, password: string, role: "organizer" | "judge" | "participant") {
  const existing = await pool.query("select id from public.users where email = $1", [email]);
  let userId: string;
  if (existing.rows.length > 0) {
    userId = (existing.rows[0] as { id: string }).id;
    console.log(`exists: ${email}`);
  } else {
    const { rows } = await pool.query(
      "insert into public.users (email, password_hash, display_name) values ($1, $2, $3) returning id",
      [email, hashPassword(password), email.split("@")[0]],
    );
    userId = (rows[0] as { id: string }).id;
    await pool.query("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [
      userId,
      email,
    ]);
    console.log(`created: ${email}`);
  }
  await pool.query(
    "insert into public.user_roles (user_id, role) values ($1, 'participant'), ($1, $2) on conflict (user_id, role) do nothing",
    [userId, role],
  );
  if (role === "judge") {
    // Link the first judge row without an account so the console has work.
    await pool.query(
      `update public.judges set user_id = $1 where id = (
         select id from public.judges where user_id is null order by display_name limit 1
       )`,
      [userId],
    );
  }
  return userId;
}

async function main() {
  const password = process.env["OJ_DEMO_PASSWORD"];
  const passwordError = password ? validatePassword(password) : "OJ_DEMO_PASSWORD is not set.";
  if (passwordError || !password) throw new Error(passwordError ?? "missing password");
  for (const role of ["organizer", "judge", "participant"] as const) {
    await ensureUser(`${role}@openjudge.local`, password, role);
  }
  await pool.end();
  console.log("Demo accounts ready: organizer@, judge@, participant@@openjudge.local");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
