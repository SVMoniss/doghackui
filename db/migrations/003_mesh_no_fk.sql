-- Mesh tables reference submissions and events by id, but those rows are
-- owned by the hosted Supabase database while the mesh store lives in the
-- self-host PostgreSQL. Hard foreign keys would reject legitimate rows, so
-- the references stay as plain uuid columns (validated at the app layer).

alter table if exists public.organism_manifests
  drop constraint if exists organism_manifests_submission_id_fkey;
alter table if exists public.organism_manifests
  drop constraint if exists organism_manifests_event_id_fkey;
alter table if exists public.criterion_assessments
  drop constraint if exists criterion_assessments_event_id_fkey;
alter table if exists public.criterion_assessments
  drop constraint if exists criterion_assessments_submission_id_fkey;
alter table if exists public.eligibility_decisions
  drop constraint if exists eligibility_decisions_event_id_fkey;
alter table if exists public.eligibility_decisions
  drop constraint if exists eligibility_decisions_submission_id_fkey;
