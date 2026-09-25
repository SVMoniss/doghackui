-- Audit trail and rubric freeze live in the self-host PostgreSQL.
-- Event ids are plain uuid references validated at the application layer.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,
  actor text not null default '',
  action text not null,
  entity text not null default '',
  entity_id text not null default '',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_events_event_id_idx on public.audit_events (event_id);
create index if not exists audit_events_created_at_idx on public.audit_events (created_at);

-- A frozen rubric is a recorded ceremony: weights snapshot hash, who, when.
-- Criteria are seed-managed; the freeze hash lets any future editor prove
-- the weights did not drift mid-event.
create table if not exists public.rubric_freeze (
  event_id uuid primary key,
  frozen boolean not null default false,
  frozen_at timestamptz,
  frozen_by text not null default '',
  weights_hash text not null default ''
);
