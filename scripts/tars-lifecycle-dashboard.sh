#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/tars-env.sh"
ROOT="$TARS_WORKSPACE_ROOT"
cd "$ROOT"

if [[ ! -d "$ROOT/lifecycle/server/node_modules" || ! -d "$ROOT/lifecycle/gui/node_modules" ]]; then
  echo "Missing dashboard Node dependencies." >&2
  echo "Run: npm run tars:lifecycle:dashboard:install" >&2
  exit 1
fi

if [[ "${TARS_LIFECYCLE_DASHBOARD_SKIP_BUILD:-}" != "1" ]]; then
  npm --prefix "$ROOT/lifecycle/gui" run build
  npm --prefix "$ROOT/lifecycle/server" run build
fi

exec npm --prefix "$ROOT/lifecycle/server" run start -- "$@"
