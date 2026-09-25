-- T1 strict: prizes and submission media live in the self-host PostgreSQL.
-- Event/submission ids are plain uuid references (no hard foreign keys to
-- the hosted database), validated at the application layer.

create table if not exists public.prizes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  position int not null default 0,
  title text not null,
  amount text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists prizes_event_id_idx on public.prizes (event_id);

-- Media buddy-table for submissions (thumbnail + image gallery). The core
-- submission row stays in the hosted database; media references it by id.
create table if not exists public.submission_media (
  submission_id uuid primary key,
  thumbnail_url text not null default '',
  images text[] not null default '{}',
  updated_at timestamptz not null default now()
);
