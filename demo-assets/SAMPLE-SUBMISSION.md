# Hands-on demo assets — submit a project in 2 minutes

These files are served by the app itself, so the URLs work offline on
`http://localhost:3000`. Paste them straight into the submit form
(`/submit` → New project).

## Thumbnail + gallery (paste into the matching fields)

```
Thumbnail URL:                http://localhost:3000/demo/thumbnail.svg
Image gallery URLs:           http://localhost:3000/demo/screenshot-1.svg, http://localhost:3000/demo/screenshot-2.svg
```

## Copy-paste submission

```
Project title:    RackFinder Mini Hands-On
Team name:        Bike Shed Test
One-line summary: Bike parking that actually exists — photo-verified
Description:      Crowdsourced bike-rack map with photos and occupancy reports.
                  Offline-first: tiles cache on first visit, zero network calls
                  after. Docker compose up to run, replay capsule included.
Repository URL:   https://github.com/example/rackfinder-mini
Live demo URL:    https://rackfinder-mini.example.org
Video URL:        https://www.youtube.com/watch?v=dQw4w9WgXcQ
Track:            Climate & Cities
Tags:             cycling, maps, civic
```

Steps: fill the form → Save draft → Submit for judging → open the project
from `/projects` (thumbnail renders on the detail page).

## Mesh flow (same project, evidence layer)

```sh
node mesh/agent.mjs analyze mesh/fixture-demo \
  --event 11111111-1111-1111-1111-111111111111 \
  --project rackfinder-mini --team "Bike Shed Test" \
  --submission <id-from-the-URL-after-submitting> \
  --out /tmp/hands-on.json --key /tmp/hands-on.key
```

Paste `/tmp/hands-on.json` + the public key into
`/observatory` → Verify and ingest → Evidence / Rubric / Decision orbits.

## Demo logins (password `openjudge`)

- `organizer@example.org` — dashboard, rubric, freeze, audit, access, webhooks
- `judge@example.org` — judging console with a draft review + pairwise duels
- `participant@example.org` — submit flow
