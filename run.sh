#!/usr/bin/env bash
# Build the frontend (if needed) and start the app on http://localhost:${PORT:-8000}
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d frontend/dist ] || [ "${REBUILD:-0}" = "1" ]; then
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi
cd backend
exec uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
