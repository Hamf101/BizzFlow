#!/bin/sh
# Runs every supabase/tests/*.sql against the local Supabase database, each
# inside its own transaction that is rolled back, and fails naming each file
# that raised. psql runs inside the database container, so the host needs no
# Postgres client. `supabase db query` is not used: it sends a file as one
# prepared statement, which refuses more than one command.
# SUPABASE_DB_CONTAINER picks another stack (default: config.toml's project).
container="${SUPABASE_DB_CONTAINER:-supabase_db_BizzFlow}"
failed=""

for file in supabase/tests/*.sql; do
  if { echo "begin;"; echo "set local client_min_messages = warning;"; cat "$file"; echo; echo "rollback;"; } |
    docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null; then
    echo "ok   $file"
  else
    echo "FAIL $file"
    failed="$failed $file"
  fi
done

[ -z "$failed" ] || { echo "SQL tests failed:$failed" >&2; exit 1; }
