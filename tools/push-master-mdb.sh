#!/bin/bash
# Upload a master.mdb to MEGA so the build machine can pull it with
# pull-master-mdb.sh. Run this on the machine that has the game install.
#
# Prerequisites:
#   megatools installed (provides `megaput`)
#   ~/.megarc with YOUR MEGA credentials (same account pull-master-mdb.sh uses)
#
# Usage (Git Bash on Windows):
#   ./tools/push-master-mdb.sh                 # uploads the local game-install mdb
#   ./tools/push-master-mdb.sh /path/to/master.mdb

set -euo pipefail

# Default to the Windows game-install location (same path update.bat assumes).
DEFAULT_MDB="$APPDATA/../LocalLow/Cygames/Umamusume/master/master.mdb"
SRC="${1:-$DEFAULT_MDB}"

# Must match MEGA_PATH in pull-master-mdb.sh.
MEGA_DIR="/Root/uma"
MEGA_PATH="$MEGA_DIR/master.mdb"

if ! command -v megaput &>/dev/null; then
    echo "Error: megatools not installed (megaput not found)." >&2
    exit 1
fi

if [ ! -f ~/.megarc ]; then
    echo "Error: ~/.megarc not found. Create it with your MEGA credentials:" >&2
    echo '  [Login]' >&2
    echo '  Username = your@email.com' >&2
    echo '  Password = yourpassword' >&2
    exit 1
fi

if [ ! -f "$SRC" ]; then
    echo "Error: master.mdb not found at: $SRC" >&2
    echo "Launch the game so it writes a fresh DB, or pass a path." >&2
    exit 1
fi

SKILLS=$(sqlite3 "$SRC" "SELECT count(*) FROM skill_data" 2>/dev/null || echo "?")
echo "Uploading $SRC ($SKILLS skills) to MEGA:$MEGA_PATH ..."

# Ensure the remote folder exists (ignore "already exists").
megamkdir "$MEGA_DIR" 2>/dev/null || true

# megaput won't overwrite; remove the old copy first if present.
megarm "$MEGA_PATH" 2>/dev/null || true

megaput --path "$MEGA_PATH" "$SRC"
echo "Done. Pull it on the build machine with ./tools/pull-master-mdb.sh"
