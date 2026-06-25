#!/bin/bash
# Linux/Mac equivalent of update.bat.
# Regenerates the Global data JSONs from a master.mdb, then runs the build.
#
# Prerequisites: perl with DBI + DBD::SQLite (e.g. `sudo apt install
# libdbi-perl libdbd-sqlite3-perl`), plus `node` and `sqlite3` for the build.
#
# Usage:
#   ./update.sh                 # uses ../docs/master.mdb (what pull-master-mdb.sh writes)
#   ./update.sh /path/to/master.mdb

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

MASTERMDB="${1:-../docs/master.mdb}"

if [ ! -f "$MASTERMDB" ]; then
    echo "Error: master.mdb not found at: $MASTERMDB" >&2
    echo "Pull it first with ./tools/pull-master-mdb.sh, or pass a path." >&2
    exit 1
fi

echo "Regenerating Global data JSONs from $MASTERMDB ..."
perl ../uma-skill-tools/tools/make_skill_data.pl "$MASTERMDB" > skill_data.json
perl make_global_skillnames.pl "$MASTERMDB" > skillnames.json
perl make_global_skill_meta.pl "$MASTERMDB" > skill_meta.json
perl make_global_uma_info.pl "$MASTERMDB"   # writes umas.json in place

# Note: course_data.json is NOT regenerated here (layouts rarely change).
# If a patch adds/changes courses, run:
#   perl make_global_course_data.pl "$MASTERMDB" courseeventparams > course_data.json

echo "Building umalator-global ..."
node build.mjs
