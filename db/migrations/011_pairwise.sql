-- Pairwise judging mode: a judge sees two projects and picks the better
-- one. Voters are users (must hold judge/organizer/admin at vote time);
-- winners/losers must be submitted projects of the same event.

create table if not exists public.pairwise_votes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  voter_key text not null,
  winner_id uuid not null,
  loser_id uuid not null,
  created_at timestamptz not null default now(),
  check (winner_id <> loser_id)
);
create index if not exists pairwise_votes_event_id_idx on public.pairwise_votes (event_id);
create index if not exists pairwise_votes_voter_idx on public.pairwise_votes (voter_key);
