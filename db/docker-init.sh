#!/bin/sh
# Runs once, on the first boot of an empty Postgres volume.
set -e

for file in /docker-entrypoint-initdb.d/migrations/*.sql; do
  echo "applying migration $file"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$file"
done

if [ "${OPENJUDGE_SEED_DEMO:-true}" = "true" ]; then
  for seed in /opt/openjudge/seed*.sql; do
    [ -f "$seed" ] || continue
    echo "loading demo data $seed"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$seed"
  done
  echo "acceptance auth headers (also in .dogfood.toml [auth]):"
  echo "  organizer   -> Cookie: oj_session=df-org-7f2a9c"
  echo "  judge_a     -> Cookie: oj_session=df-jdga-91bc4e"
  echo "  judge_b     -> Cookie: oj_session=df-jdgb-44de8a"
  echo "  participant -> Cookie: oj_session=df-prt-2e88f1"
fi
