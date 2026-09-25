# Database

Two ways to get the schema in place.

## docker-compose (recommended)

```sh
cp .env.example .env
docker compose up --build
```

On the first boot of an empty volume, `db/docker-init.sh` applies every file in
`db/migrations/` in filename order and then loads `db/seed.sql` unless
`OPENJUDGE_SEED_DEMO=false`.

## Existing PostgreSQL 16+

```sh
export DATABASE_URL=postgres://user:pass@localhost:5432/openjudge

# schema
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done

# optional demo data
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed.sql
```

## Reset

```sh
docker compose down -v && docker compose up --build
```

## Files

| File | Purpose |
| --- | --- |
| `migrations/001_schema.sql` | Core tables, constraints, helper functions, triggers |
| `migrations/002_mesh.sql` | Evidence store: manifests, claims, artifacts, links, runs, anomalies, assessments, eligibility |
| `migrations/003_mesh_no_fk.sql` | Cross-domain references stay application-validated |
| `migrations/004_teams.sql` | Teams, members, invite links |
| `migrations/005_audit.sql` | Audit trail + rubric freeze |
| `migrations/006_prizes_media.sql` | Prizes + submission media buddy-table |
| `migrations/007_judge_scopes.sql` | Track-scoped judges |
| `migrations/008_sessions.sql` | Local session auth |
| `seed.sql` | One demo event, 3 tracks, 5 criteria, 12 projects, 5 judges, balanced assignments and biased scores |
| `seed_mesh.sql` | Demo organism, claim links, replay run, anomalies, assessments |
| `seed_prizes.sql` | Demo prizes |
| `docker-init.sh` | First-boot hook used by the compose Postgres service |

## Notes

This is the only database. Authentication is local (scrypt passwords in
`users`, opaque sessions in `sessions`), and access control is enforced by
the application layer on every query. `DATA-MODEL.md` documents every table
and the access rules.
