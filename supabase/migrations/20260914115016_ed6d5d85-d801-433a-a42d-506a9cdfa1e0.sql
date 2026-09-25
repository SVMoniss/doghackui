-- ===== roles =====
create type public.app_role as enum ('organizer', 'judge', 'participant');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "organizers read roles" on public.user_roles for select to authenticated using (public.has_role(auth.uid(), 'organizer'));
create policy "organizers manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'participant')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- ===== events =====
create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  submissions_open boolean not null default true,
  judging_open boolean not null default false,
  reviews_per_submission int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.events to anon;
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create policy "events public read" on public.events for select using (true);
create policy "organizers manage events" on public.events for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (event_id, slug)
);
grant select on public.tracks to anon;
grant select, insert, update, delete on public.tracks to authenticated;
grant all on public.tracks to service_role;
alter table public.tracks enable row level security;
create policy "tracks public read" on public.tracks for select using (true);
create policy "organizers manage tracks" on public.tracks for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  description text,
  weight numeric not null default 1,
  min_score int not null default 1,
  max_score int not null default 10,
  position int not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.criteria to anon;
grant select, insert, update, delete on public.criteria to authenticated;
grant all on public.criteria to service_role;
alter table public.criteria enable row level security;
create policy "criteria public read" on public.criteria for select using (true);
create policy "organizers manage criteria" on public.criteria for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

-- ===== submissions =====
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  team_name text not null,
  title text not null,
  tagline text,
  description text,
  repo_url text,
  demo_url text,
  video_url text,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.submissions to anon;
grant select, insert, update, delete on public.submissions to authenticated;
grant all on public.submissions to service_role;
alter table public.submissions enable row level security;
create trigger submissions_touch before update on public.submissions for each row execute function public.touch_updated_at();

-- ===== judges =====
create table public.judges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.judges to authenticated;
grant all on public.judges to service_role;
alter table public.judges enable row level security;

create or replace function public.owns_judge(_judge_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.judges where id = _judge_id and user_id = auth.uid())
$$;

create policy "judges read own record" on public.judges for select to authenticated using (user_id = auth.uid());
create policy "organizers manage judges" on public.judges for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create table public.conflicts (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references public.judges(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (judge_id, submission_id)
);
grant select, insert, update, delete on public.conflicts to authenticated;
grant all on public.conflicts to service_role;
alter table public.conflicts enable row level security;
create policy "judges read own conflicts" on public.conflicts for select to authenticated using (public.owns_judge(judge_id));
create policy "organizers manage conflicts" on public.conflicts for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  judge_id uuid not null references public.judges(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  comment text,
  status text not null default 'pending' check (status in ('pending', 'draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judge_id, submission_id)
);
grant select, insert, update, delete on public.assignments to authenticated;
grant all on public.assignments to service_role;
alter table public.assignments enable row level security;
create trigger assignments_touch before update on public.assignments for each row execute function public.touch_updated_at();
create policy "judges read own assignments" on public.assignments for select to authenticated using (public.owns_judge(judge_id));
create policy "judges update own assignments" on public.assignments for update to authenticated using (public.owns_judge(judge_id)) with check (public.owns_judge(judge_id));
create policy "organizers manage assignments" on public.assignments for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create or replace function public.assigned_to_me(_submission_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments a
    join public.judges j on j.id = a.judge_id
    where a.submission_id = _submission_id and j.user_id = auth.uid()
  )
$$;

create policy "submitted submissions public read" on public.submissions for select using (status = 'submitted');
create policy "owners read own submissions" on public.submissions for select to authenticated using (owner_id = auth.uid());
create policy "assigned judges read submissions" on public.submissions for select to authenticated using (public.assigned_to_me(id));
create policy "organizers read all submissions" on public.submissions for select to authenticated using (public.has_role(auth.uid(), 'organizer'));
create policy "authenticated create own submission" on public.submissions for insert to authenticated with check (owner_id = auth.uid());
create policy "owners update own submission" on public.submissions for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete own submission" on public.submissions for delete to authenticated using (owner_id = auth.uid());
create policy "organizers manage submissions" on public.submissions for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  criterion_id uuid not null references public.criteria(id) on delete cascade,
  value numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, criterion_id)
);
grant select, insert, update, delete on public.scores to authenticated;
grant all on public.scores to service_role;
alter table public.scores enable row level security;
create trigger scores_touch before update on public.scores for each row execute function public.touch_updated_at();

create or replace function public.owns_assignment(_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments a join public.judges j on j.id = a.judge_id
    where a.id = _assignment_id and j.user_id = auth.uid()
  )
$$;

create policy "judges read own scores" on public.scores for select to authenticated using (public.owns_assignment(assignment_id));
create policy "judges write own scores" on public.scores for insert to authenticated with check (public.owns_assignment(assignment_id));
create policy "judges update own scores" on public.scores for update to authenticated using (public.owns_assignment(assignment_id)) with check (public.owns_assignment(assignment_id));
create policy "organizers manage scores" on public.scores for all to authenticated using (public.has_role(auth.uid(), 'organizer')) with check (public.has_role(auth.uid(), 'organizer'));

create index on public.submissions (event_id, status);
create index on public.assignments (event_id, judge_id);
create index on public.assignments (submission_id);
create index on public.scores (assignment_id);

-- ===== demo data =====
insert into public.events (id, slug, name, tagline, description, starts_at, ends_at, submissions_open, judging_open, reviews_per_submission)
values ('11111111-1111-1111-1111-111111111111', 'openhack-2026', 'OpenHack 2026',
  'Build in the open for 48 hours',
  'A community hackathon for open-source builders. Ship something small, useful and honest, then let a panel of judges review it.',
  '2026-10-02T09:00:00Z', '2026-10-04T17:00:00Z', true, true, 3);

insert into public.tracks (id, event_id, slug, name) values
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'developer-tools', 'Developer Tools'),
  ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'climate', 'Climate & Cities'),
  ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'accessibility', 'Accessibility');

insert into public.criteria (id, event_id, name, description, weight, min_score, max_score, position) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Impact', 'How much does this matter to real people?', 1, 1, 10, 1),
  ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Innovation', 'How original is the approach?', 1, 1, 10, 2),
  ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Technical Execution', 'How well is it built for the time available?', 1, 1, 10, 3),
  ('33333333-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Design', 'Is it clear and pleasant to use?', 1, 1, 10, 4),
  ('33333333-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Presentation', 'Is the demo convincing and honest?', 1, 1, 10, 5);

insert into public.judges (id, event_id, display_name, email, active) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ada Reyes', 'ada@example.org', true),
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bo Nkemdirim', 'bo@example.org', true),
  ('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Chen Wei', 'chen@example.org', true),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Dara Osei', 'dara@example.org', true),
  ('44444444-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Elif Kaya', 'elif@example.org', true);

insert into public.submissions (id, event_id, track_id, team_name, title, tagline, description, repo_url, demo_url, tags, status) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Null Pointers', 'LogLens', 'Readable stack traces for tired humans', 'Parses noisy production logs and groups them into plain-language incidents.', 'https://example.org/loglens', 'https://example.org/loglens/demo', '{logging,devtools}', 'submitted'),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Semicolon', 'MigrateMate', 'Database migrations you can read out loud', 'Turns SQL migrations into a plain-language changelog and a rollback plan.', 'https://example.org/migratemate', null, '{database,sql}', 'submitted'),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Heat Sink', 'CoolStreets', 'Find the shady walking route', 'Uses open tree-canopy data to route pedestrians along cooler streets.', 'https://example.org/coolstreets', 'https://example.org/coolstreets/demo', '{maps,climate}', 'submitted'),
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Grid Goblins', 'WattWatch', 'Household energy, minus the spreadsheets', 'Reads smart-meter exports and shows which appliance costs what.', 'https://example.org/wattwatch', null, '{energy}', 'submitted'),
  ('55555555-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Signal Boost', 'CaptionCue', 'Live captions for community events', 'Browser-based live captioning with a big-screen presenter view.', 'https://example.org/captioncue', 'https://example.org/captioncue/demo', '{a11y,audio}', 'submitted'),
  ('55555555-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Tab Order', 'FocusTrail', 'See your keyboard path', 'Visualises focus order on any page so teams can fix confusing navigation.', 'https://example.org/focustrail', null, '{a11y,testing}', 'submitted'),
  ('55555555-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Rubber Duck', 'ReviewRadar', 'Pull requests that explain themselves', 'Summarises a diff into risks, tests touched and files worth a human look.', 'https://example.org/reviewradar', 'https://example.org/reviewradar/demo', '{git,review}', 'submitted'),
  ('55555555-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Bike Shed', 'RackFinder', 'Bike parking that actually exists', 'Crowdsourced bike-rack map with photos and occupancy reports.', 'https://example.org/rackfinder', null, '{cycling,maps}', 'submitted'),
  ('55555555-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Plain Words', 'ClearForm', 'Government forms in human language', 'Rewrites official forms into plain language while keeping the legal fields.', 'https://example.org/clearform', 'https://example.org/clearform/demo', '{a11y,forms}', 'submitted'),
  ('55555555-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Cache Money', 'SeedSafe', 'Reproducible test data', 'Generates deterministic seed data from a schema so bugs reproduce everywhere.', 'https://example.org/seedsafe', null, '{testing,data}', 'submitted'),
  ('55555555-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Compost Heap', 'BinDay', 'Never miss the collection again', 'Turns council collection calendars into calm reminders.', 'https://example.org/binday', 'https://example.org/binday/demo', '{waste,civic}', 'submitted'),
  ('55555555-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Quiet Room', 'SensoryMap', 'Quiet places, mapped', 'Community map of low-noise, low-light spaces in public buildings.', 'https://example.org/sensorymap', null, '{a11y,maps}', 'submitted');

-- balanced round-robin demo assignments: 12 submissions x 3 reviews across 5 judges
with s as (
  select id, row_number() over (order by title) - 1 as si
  from public.submissions where event_id = '11111111-1111-1111-1111-111111111111'
), j as (
  select id, row_number() over (order by display_name) - 1 as ji
  from public.judges where event_id = '11111111-1111-1111-1111-111111111111'
), pairs as (
  select s.id as submission_id, k.k, ((s.si * 3 + k.k) % 5) as ji
  from s cross join (select generate_series(0, 2) as k) k
)
insert into public.assignments (event_id, judge_id, submission_id, status, submitted_at, comment)
select '11111111-1111-1111-1111-111111111111', j.id, p.submission_id, 'submitted', now(),
  'Solid scope for a weekend build; documentation could go further.'
from pairs p join j on j.ji = p.ji;

-- deterministic demo scores with per-judge harshness bias
with j as (
  select id, case row_number() over (order by display_name)
    when 1 then -2 when 2 then -1 when 3 then 0 when 4 then 1 else 2 end as bias
  from public.judges where event_id = '11111111-1111-1111-1111-111111111111'
)
insert into public.scores (assignment_id, criterion_id, value)
select a.id, c.id,
  greatest(1, least(10,
    4 + (abs(hashtext(a.submission_id::text || c.id::text)) % 6) + j.bias
  ))
from public.assignments a
join j on j.id = a.judge_id
join public.criteria c on c.event_id = a.event_id;
