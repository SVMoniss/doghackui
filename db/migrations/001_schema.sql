-- OpenJudge self-host schema (plain PostgreSQL 16+)
--
-- The hosted build runs on Supabase, where authentication and row-level
-- security are provided by the platform. This standalone schema keeps the exact
-- same tables and constraints but owns its own users table, and leaves access
-- control to the application layer.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text,
  created_at timestamptz not null default now()
);

-- Stub so any policy-style helper SQL stays valid outside Supabase.
create or replace function public.current_user_id() returns uuid
language sql stable as $fn$ select nullif(current_setting('openjudge.user_id', true), '')::uuid $fn$;

-- ===== roles =====
create type public.app_role as enum ('organizer', 'judge', 'participant');

create table public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;



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
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (event_id, slug)
);

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

-- ===== submissions =====
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  owner_id uuid references public.users(id) on delete set null,
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
create trigger submissions_touch before update on public.submissions for each row execute function public.touch_updated_at();

-- ===== judges =====
create table public.judges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  display_name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.owns_judge(_judge_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.judges where id = _judge_id and user_id = public.current_user_id())
$$;


create table public.conflicts (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references public.judges(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (judge_id, submission_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  judge_id uuid not null references public.judges(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  comment text,
  -- true when the certification engine asked for this review to settle a prize boundary
  targeted boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judge_id, submission_id)
);
create trigger assignments_touch before update on public.assignments for each row execute function public.touch_updated_at();

create or replace function public.assigned_to_me(_submission_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments a
    join public.judges j on j.id = a.judge_id
    where a.submission_id = _submission_id and j.user_id = public.current_user_id()
  )
$$;


create table public.scores (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  criterion_id uuid not null references public.criteria(id) on delete cascade,
  value numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, criterion_id)
);
create trigger scores_touch before update on public.scores for each row execute function public.touch_updated_at();

create or replace function public.owns_assignment(_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments a join public.judges j on j.id = a.judge_id
    where a.id = _assignment_id and j.user_id = public.current_user_id()
  )
$$;


create index on public.submissions (event_id, status);
create index on public.assignments (event_id, judge_id);
create index on public.assignments (submission_id);
create index on public.scores (assignment_id);
