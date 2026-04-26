#!/usr/bin/env bash
# Daily commit & push for Soccer Stats — call after match_data.json + dashboard are updated.
# Safe to run repeatedly: no-op if nothing changed.
set -e
cd "/sessions/charming-awesome-faraday/mnt/Soccer Stats" || exit 1

# Set identity if missing
git config user.name >/dev/null 2>&1 || git config user.name "Looneyz25"
git config user.email >/dev/null 2>&1 || git config user.email "l.vorabouth@gmail.com"

# Clear stale lock from previous interrupted Windows-side ops (best-effort)
[ -f .git/index.lock ] && rm -f .git/index.lock 2>/dev/null || true

# Stage only the files this routine owns
git add index.html match_data.json predictions_*.json predictions_*.md 2>/dev/null || true

# Bail if nothing to commit
if git diff --cached --quiet; then
  echo "nothing to commit"
  exit 0
fi

DATE=$(date -u +%Y-%m-%d)
git commit -m "Daily run ${DATE}: settle results + new forecasts + odds refresh"
git push origin main
echo "pushed to origin/main"
