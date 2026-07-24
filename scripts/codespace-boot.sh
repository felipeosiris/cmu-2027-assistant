#!/usr/bin/env bash
# Boot / heal the CMU assistant inside a Codespace.
set -euo pipefail
cd /workspaces/cmu-2027-assistant 2>/dev/null || cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env — set CURSOR_API_KEY and GOOGLE_PLACES_API_KEY" >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if [[ ! -d client/dist ]]; then
  npm ci
  npm run build
fi

pm2 delete cmu-ai >/dev/null 2>&1 || true
pm2 start "npx tsx server/index.ts" --name cmu-ai --cwd "$(pwd)"
pm2 save >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:8788/api/health" >/dev/null; then
    curl -fsS "http://127.0.0.1:8788/api/health"
    echo
    exit 0
  fi
  sleep 1
done

echo "Server failed to become healthy" >&2
pm2 logs cmu-ai --lines 40 --nostream >&2 || true
exit 1
