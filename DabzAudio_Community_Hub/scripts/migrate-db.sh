#!/usr/bin/env bash
set -euo pipefail

# Migrate the Community Hub Postgres from one Railway service to another.
# Usage:
#   export OLD_DATABASE_URL="postgres://user:pass@old-host/db"
#   export NEW_DATABASE_URL="postgres://user:pass@new-host/db"
#   ./scripts/migrate-db.sh

if [ -z "${OLD_DATABASE_URL:-}" ] || [ -z "${NEW_DATABASE_URL:-}" ]; then
  echo "ERROR: set OLD_DATABASE_URL and NEW_DATABASE_URL first."
  echo "Get them from Railway: Project -> Service -> Variables"
  exit 1
fi

DUMP_FILE="/tmp/community_hub_$(date +%s).dump"

echo "Dumping from old Community Hub database..."
pg_dump "$OLD_DATABASE_URL" -n public -Fc -c -O -x -f "$DUMP_FILE"

echo "Restoring to new Community Hub database..."
pg_restore "$NEW_DATABASE_URL" -n public -c -O -x -d "$NEW_DATABASE_URL" "$DUMP_FILE" || true

echo "Cleaning up..."
rm -f "$DUMP_FILE"

echo "Done. Check the new Community Hub for posts."
