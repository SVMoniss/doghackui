-- Judge participation records (signed) + anonymous ballot tokens.

-- Single platform keypair for signing participation records. Generated
-- lazily by the app on first use; private key never leaves the database.
create table if not exists public.platform_keys (
  id text primary key default 'default',
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

-- One row per submitted review: who judged what, signed, verifiable.
create table if not exists public.participation_records (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null,
  event_id uuid not null,
  submission_id uuid not null,
  assignment_id uuid not null unique,
  submitted_at timestamptz not null default now(),
  signature text not null,
  created_at timestamptz not null default now()
);
create index if not exists participation_records_judge_idx on public.participation_records (judge_id);

-- Anonymous ballot tokens: whoever holds one may cast community votes.
-- Bearer by design; organizers control distribution and can revoke.
create table if not exists public.ballot_tokens (
  token text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null default '',
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ballot_tokens_event_idx on public.ballot_tokens (event_id);
