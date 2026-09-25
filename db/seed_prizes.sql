-- OpenJudge demo prizes for the OpenHack 2026 event.
insert into public.prizes (id, event_id, position, title, amount) values
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'Grand Prize', '$800'),
  ('88888888-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 2, 'Runner-Up', '$500'),
  ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 3, 'Third Place', '$350')
on conflict (id) do nothing;
