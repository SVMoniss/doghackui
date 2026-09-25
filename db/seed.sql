-- OpenJudge demo data: one event, 3 tracks, 5 criteria, 12 projects,
-- 5 judges, balanced assignments and scores with per-judge harshness bias.
insert into public.events (id, slug, name, tagline, description, starts_at, ends_at, submissions_open, judging_open, reviews_per_submission)
values ('11111111-1111-1111-1111-111111111111', 'openhack-2026', 'OpenHack 2026',
  'Build in the open for 48 hours',
  'A community hackathon for open-source builders. Ship something small, useful and honest, then let a panel of judges review it.',
  '2026-10-02T09:00:00Z', '2026-10-04T17:00:00Z', true, true, 3);

insert into public.tracks (id, event_id, slug, name) values
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'developer-tools', 'Developer Tools'),
  ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'climate', 'Climate & Cities'),
  ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'accessibility', 'Accessibility');

insert into public.criteria (id, event_id, name, description, weight, min_score, max_score, position) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Impact', 'How much does this matter to real people?', 1, 1, 10, 1),
  ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Innovation', 'How original is the approach?', 1, 1, 10, 2),
  ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Technical Execution', 'How well is it built for the time available?', 1, 1, 10, 3),
  ('33333333-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Design', 'Is it clear and pleasant to use?', 1, 1, 10, 4),
  ('33333333-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Presentation', 'Is the demo convincing and honest?', 1, 1, 10, 5);

insert into public.judges (id, event_id, display_name, email, active) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ada Reyes', 'ada@example.org', true),
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bo Nkemdirim', 'bo@example.org', true),
  ('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Chen Wei', 'chen@example.org', true),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Dara Osei', 'dara@example.org', true),
  ('44444444-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Elif Kaya', 'elif@example.org', true);

insert into public.submissions (id, event_id, track_id, team_name, title, tagline, description, repo_url, demo_url, tags, status) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Null Pointers', 'LogLens', 'Readable stack traces for tired humans', 'Parses noisy production logs and groups them into plain-language incidents.', 'https://example.org/loglens', 'https://example.org/loglens/demo', '{logging,devtools}', 'submitted'),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Semicolon', 'MigrateMate', 'Database migrations you can read out loud', 'Turns SQL migrations into a plain-language changelog and a rollback plan.', 'https://example.org/migratemate', null, '{database,sql}', 'submitted'),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Heat Sink', 'CoolStreets', 'Find the shady walking route', 'Uses open tree-canopy data to route pedestrians along cooler streets.', 'https://example.org/coolstreets', 'https://example.org/coolstreets/demo', '{maps,climate}', 'submitted'),
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Grid Goblins', 'WattWatch', 'Household energy, minus the spreadsheets', 'Reads smart-meter exports and shows which appliance costs what.', 'https://example.org/wattwatch', null, '{energy}', 'submitted'),
  ('55555555-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Signal Boost', 'CaptionCue', 'Live captions for community events', 'Browser-based live captioning with a big-screen presenter view.', 'https://example.org/captioncue', 'https://example.org/captioncue/demo', '{a11y,audio}', 'submitted'),
  ('55555555-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Tab Order', 'FocusTrail', 'See your keyboard path', 'Visualises focus order on any page so teams can fix confusing navigation.', 'https://example.org/focustrail', null, '{a11y,testing}', 'submitted'),
  ('55555555-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Rubber Duck', 'ReviewRadar', 'Pull requests that explain themselves', 'Summarises a diff into risks, tests touched and files worth a human look.', 'https://example.org/reviewradar', 'https://example.org/reviewradar/demo', '{git,review}', 'submitted'),
  ('55555555-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Bike Shed', 'RackFinder', 'Bike parking that actually exists', 'Crowdsourced bike-rack map with photos and occupancy reports.', 'https://example.org/rackfinder', null, '{cycling,maps}', 'submitted'),
  ('55555555-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Plain Words', 'ClearForm', 'Government forms in human language', 'Rewrites official forms into plain language while keeping the legal fields.', 'https://example.org/clearform', 'https://example.org/clearform/demo', '{a11y,forms}', 'submitted'),
  ('55555555-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Cache Money', 'SeedSafe', 'Reproducible test data', 'Generates deterministic seed data from a schema so bugs reproduce everywhere.', 'https://example.org/seedsafe', null, '{testing,data}', 'submitted'),
  ('55555555-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Compost Heap', 'BinDay', 'Never miss the collection again', 'Turns council collection calendars into calm reminders.', 'https://example.org/binday', 'https://example.org/binday/demo', '{waste,civic}', 'submitted'),
  ('55555555-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Quiet Room', 'SensoryMap', 'Quiet places, mapped', 'Community map of low-noise, low-light spaces in public buildings.', 'https://example.org/sensorymap', null, '{a11y,maps}', 'submitted');

-- balanced round-robin demo assignments: 12 submissions x 3 reviews across 5 judges
with s as (
  select id, row_number() over (order by title) - 1 as si
  from public.submissions where event_id = '11111111-1111-1111-1111-111111111111'
), j as (
  select id, row_number() over (order by display_name) - 1 as ji
  from public.judges where event_id = '11111111-1111-1111-1111-111111111111'
), pairs as (
  select s.id as submission_id, k.k, ((s.si * 3 + k.k) % 5) as ji
  from s cross join (select generate_series(0, 2) as k) k
)
insert into public.assignments (event_id, judge_id, submission_id, status, submitted_at, comment)
select '11111111-1111-1111-1111-111111111111', j.id, p.submission_id, 'submitted', now(),
  'Solid scope for a weekend build; documentation could go further.'
from pairs p join j on j.ji = p.ji;

-- deterministic demo scores with per-judge harshness bias
with j as (
  select id, case row_number() over (order by display_name)
    when 1 then -2 when 2 then -1 when 3 then 0 when 4 then 1 else 2 end as bias
  from public.judges where event_id = '11111111-1111-1111-1111-111111111111'
)
insert into public.scores (assignment_id, criterion_id, value)
select a.id, c.id,
  greatest(1, least(10,
    4 + (abs(hashtext(a.submission_id::text || c.id::text)) % 6) + j.bias
  ))
from public.assignments a
join j on j.id = a.judge_id
join public.criteria c on c.event_id = a.event_id;
