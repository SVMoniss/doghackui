-- OpenJudge demo accounts (LOCAL FIXTURE ONLY, password: openjudge).
-- organizer@example.org  -> organizer role (claims dashboard, freezes rubric)
-- judge@example.org      -> linked judge row (Ada Reyes) with assignments
-- participant@example.org -> plain participant
-- These exist so a stranger can sign in after one command with no setup.

insert into public.users (id, email, password_hash, display_name) values
  ('99999999-0000-0000-0000-000000000001', 'organizer@example.org',
   'scrypt$16384$8$1$9ed5eabbb71486e3373248d57d2a2cd1$dc1ce9cd8912414ec8d4236439c4fdd04463dc22e2cbab741464597c87a9028429ac46705efc6e888c06b72cdeefd6edb8fbd9aae5ec13ae4fe470366f16ae4a',
   'organizer'),
  ('99999999-0000-0000-0000-000000000002', 'judge@example.org',
   'scrypt$16384$8$1$9ed5eabbb71486e3373248d57d2a2cd1$dc1ce9cd8912414ec8d4236439c4fdd04463dc22e2cbab741464597c87a9028429ac46705efc6e888c06b72cdeefd6edb8fbd9aae5ec13ae4fe470366f16ae4a',
   'judge'),
  ('99999999-0000-0000-0000-000000000003', 'participant@example.org',
   'scrypt$16384$8$1$9ed5eabbb71486e3373248d57d2a2cd1$dc1ce9cd8912414ec8d4236439c4fdd04463dc22e2cbab741464597c87a9028429ac46705efc6e888c06b72cdeefd6edb8fbd9aae5ec13ae4fe470366f16ae4a',
   'participant')
on conflict (id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  display_name = excluded.display_name;

insert into public.profiles (id, email, display_name) values
  ('99999999-0000-0000-0000-000000000001', 'organizer@example.org', 'organizer'),
  ('99999999-0000-0000-0000-000000000002', 'judge@example.org', 'judge'),
  ('99999999-0000-0000-0000-000000000003', 'participant@example.org', 'participant')
on conflict (id) do update set email = excluded.email, display_name = excluded.display_name;

insert into public.user_roles (user_id, role) values
  ('99999999-0000-0000-0000-000000000001', 'organizer'),
  ('99999999-0000-0000-0000-000000000001', 'admin'),
  ('99999999-0000-0000-0000-000000000001', 'participant'),
  ('99999999-0000-0000-0000-000000000002', 'judge'),
  ('99999999-0000-0000-0000-000000000002', 'participant'),
  ('99999999-0000-0000-0000-000000000003', 'participant')
on conflict (user_id, role) do nothing;

-- Link the demo judge login to the seeded Ada Reyes judge row.
update public.judges set user_id = '99999999-0000-0000-0000-000000000002'
where id = '44444444-0000-0000-0000-000000000001' and user_id is null;

-- Reset one of Ada's assignments (MigrateMate) back to draft so the judge
-- console demo starts with work to do. Everything else stays submitted, so
-- the leaderboard, certificate, and LogLens receipt render with real data.
update public.assignments set status = 'draft', submitted_at = null, comment = null
where judge_id = '44444444-0000-0000-0000-000000000001'
  and submission_id = '55555555-0000-0000-0000-000000000002';

delete from public.scores where assignment_id in (
  select id from public.assignments
  where judge_id = '44444444-0000-0000-0000-000000000001'
    and submission_id = '55555555-0000-0000-0000-000000000002'
);
