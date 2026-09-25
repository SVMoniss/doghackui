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
fi
