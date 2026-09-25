-- Organizer-defined custom submission questions + answers.

create table if not exists public.custom_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null,
  kind text not null default 'text' check (kind in ('text', 'url', 'number', 'boolean')),
  required boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists custom_questions_event_id_idx on public.custom_questions (event_id);

create table if not exists public.submission_answers (
  submission_id uuid not null references public.submissions(id) on delete cascade,
  question_id uuid not null references public.custom_questions(id) on delete cascade,
  value text not null default '',
  updated_at timestamptz not null default now(),
  primary key (submission_id, question_id)
);
