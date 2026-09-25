-- Teams and invite links live in the self-host PostgreSQL (like the mesh
-- store): event/submission ids are plain uuid references validated at the
-- application layer, never hard foreign keys to the hosted database.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  name text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists teams_event_id_idx on public.teams (event_id);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_key text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (team_id, user_key)
);
create index if not exists team_members_team_id_idx on public.team_members (team_id);
create index if not exists team_members_user_key_idx on public.team_members (user_key);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  token text not null unique,
  created_by text not null default '',
  expires_at timestamptz,
  revoked boolean not null default false,
  uses int not null default 0,
  max_uses int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists team_invites_team_id_idx on public.team_invites (team_id);
