-- OpenJudge Mesh: evidence-first submission and evaluation pipeline.
--
-- Stores signed project manifests, claim-evidence graphs, replay runs,
-- anomalies, human criterion assessments, and eligibility decisions.
-- Plain PostgreSQL: access control stays in the application layer, exactly
-- like the core schema in 001_schema.sql.

-- ===== sealed manifests =====
create table if not exists public.organism_manifests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions(id) on delete set null,
  event_id uuid references public.events(id) on delete cascade,
  owner_key text not null default '',
  project_ref text not null default '',
  team_ref text not null default '',
  manifest jsonb not null,
  merkle_root text not null,
  public_key text not null default '',
  public_key_id text not null default '',
  agent_version text not null default '',
  sealed boolean not null default false,
  sealed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists organism_manifests_event_id_idx on public.organism_manifests (event_id);
create index if not exists organism_manifests_submission_id_idx on public.organism_manifests (submission_id);
create index if not exists organism_manifests_owner_key_idx on public.organism_manifests (owner_key);

-- ===== claims =====
create table if not exists public.organism_claims (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.organism_manifests(id) on delete cascade,
  claim_id text not null,
  statement text not null,
  category text not null,
  expected_evidence text[] not null default '{}',
  evidence_refs text[] not null default '{}',
  status text not null default 'UNVERIFIED'
    check (status in ('SUPPORTED', 'PARTIAL', 'UNVERIFIED', 'CONTRADICTED')),
  created_at timestamptz not null default now(),
  unique (manifest_id, claim_id)
);
create index if not exists organism_claims_manifest_id_idx on public.organism_claims (manifest_id);

-- ===== evidence artifacts (references by content hash, never secrets) =====
create table if not exists public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.organism_manifests(id) on delete cascade,
  artifact_id text not null,
  kind text not null,
  content_hash text not null,
  uri text not null,
  artifact_created_at timestamptz,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (manifest_id, artifact_id)
);
create index if not exists evidence_artifacts_manifest_id_idx on public.evidence_artifacts (manifest_id);

-- ===== claim-evidence links =====
create table if not exists public.claim_links (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.organism_manifests(id) on delete cascade,
  claim_id text not null,
  evidence_id text not null,
  relationship text not null
    check (relationship in ('SUPPORTS', 'PARTIALLY_SUPPORTS', 'CONTRADICTS', 'CONTEXT')),
  confidence numeric not null default 0,
  explanation text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists claim_links_manifest_id_idx on public.claim_links (manifest_id);

-- ===== replay runs =====
create table if not exists public.replay_runs (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.organism_manifests(id) on delete cascade,
  scenario_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'passed', 'failed')),
  steps jsonb not null default '[]',
  report jsonb,
  submitted_by text not null default '',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists replay_runs_manifest_id_idx on public.replay_runs (manifest_id);

-- ===== anomalies (every automated finding is contestable) =====
create table if not exists public.organism_anomalies (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.organism_manifests(id) on delete cascade,
  anomaly_key text not null,
  severity text not null,
  category text not null,
  finding text not null,
  confidence numeric not null default 0,
  evidence_refs text[] not null default '{}',
  allowed_actions text[] not null default '{}',
  state text not null default 'open'
    check (state in ('open', 'explained', 'waived', 'resolved')),
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (manifest_id, anomaly_key)
);
create index if not exists organism_anomalies_manifest_id_idx on public.organism_anomalies (manifest_id);

-- ===== human criterion assessments (1-10 integers, fixed event weights) =====
create table if not exists public.criterion_assessments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  assessor_key text not null,
  criterion text not null,
  score int not null check (score between 1 and 10),
  confidence int not null default 3 check (confidence between 1 and 5),
  rationale text not null default '',
  evidence_refs text[] not null default '{}',
  acknowledged_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, submission_id, assessor_key, criterion)
);
create trigger criterion_assessments_touch
  before update on public.criterion_assessments
  for each row execute function public.touch_updated_at();
create index if not exists criterion_assessments_event_id_submission_id_idx on public.criterion_assessments (event_id, submission_id);

-- ===== eligibility (separate from ranking, never a hidden score penalty) =====
create table if not exists public.eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  status text not null default 'ELIGIBLE'
    check (status in ('ELIGIBLE', 'PROVISIONAL', 'INELIGIBLE', 'MANUAL_REVIEW_REQUIRED')),
  reason text not null default '',
  decided_by text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, submission_id)
);
create index if not exists eligibility_decisions_event_id_idx on public.eligibility_decisions (event_id);
