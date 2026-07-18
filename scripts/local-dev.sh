#!/usr/bin/env bash
# Installs all Node + Python workspace dependencies for local development.
set -euo pipefail

npm install

for svc in services/voiceover services/caption-sync; do
  if [ -f "$svc/requirements.txt" ]; then
    python3 -m pip install -r "$svc/requirements.txt"
  fi
done

echo "Done. Copy .env.example to .env and fill in your API keys next."
