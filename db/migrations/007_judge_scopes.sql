-- Track-scoped judges: a judge with a scope row only ever sees and scores
-- submissions on that track (isolation matrix). No scope row = all tracks.
-- Judge ids reference the hosted judges table by uuid (no hard FK).

create table if not exists public.judge_scopes (
  judge_id uuid primary key,
  track_id uuid,
  updated_at timestamptz not null default now()
);
