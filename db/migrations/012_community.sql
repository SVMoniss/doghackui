-- T3 community layer: voting with configurable rules, hidden results,
-- and comment threads. Votes never touch judge scores; they tally separately.

alter table public.events add column if not exists voting_mode text not null default 'off'
  check (voting_mode in ('off', 'one_person_one_vote', 'quadratic'));
alter table public.events add column if not exists voting_open boolean not null default false;
alter table public.events add column if not exists results_published boolean not null default false;

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  voter_key text not null,
  votes int not null default 1 check (votes between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, submission_id, voter_key)
);
create index if not exists votes_event_id_idx on public.votes (event_id);
create index if not exists votes_voter_idx on public.votes (voter_key, created_at);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  author_key text not null default '',
  body text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_submission_idx on public.comments (submission_id, created_at);
create trigger votes_touch before update on public.votes for each row execute function public.touch_updated_at();
