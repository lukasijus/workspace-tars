#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/tars-env.sh"
ROOT="$TARS_WORKSPACE_ROOT"
cd "$ROOT"
exec node lifecycle/submit_approved.js "$@"
