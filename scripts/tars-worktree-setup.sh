#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/tars-env.sh"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <worktree-path> [branch-name]"
  echo "Example: $0 ../agent-workspace-1 feature-settings"
  exit 1
fi

WORKTREE_PATH="$1"
BRANCH_NAME="${2:-$(basename "$WORKTREE_PATH")}"
ROOT="$TARS_WORKSPACE_ROOT"

cd "$ROOT"

# Check if branch already exists locally
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Branch '$BRANCH_NAME' exists. Checking out in new worktree..."
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
else
  echo "Creating new branch '$BRANCH_NAME' for worktree..."
  git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"
fi

# Resolve absolute path of the new worktree
WORKTREE_ABS_PATH="$(cd "$WORKTREE_PATH" && pwd)"

echo "Copying .env file..."
if [[ -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env" "$WORKTREE_ABS_PATH/.env"
  echo "Copied .env successfully."
else
  echo "Warning: No .env file found in $ROOT to copy."
fi

echo "Installing npm dependencies in isolated environment..."
cd "$WORKTREE_ABS_PATH"

echo "[1/4] Installing root dependencies..."
npm install --silent

echo "[2/4] Installing lifecycle/gui dependencies..."
npm --prefix lifecycle/gui install --silent

echo "[3/4] Installing lifecycle/server dependencies..."
npm --prefix lifecycle/server install --silent

echo "[4/4] Installing linkedin_search dependencies..."
npm --prefix linkedin_search install --silent

echo ""
echo "========================================="
echo "Worktree setup complete in:"
echo "  $WORKTREE_ABS_PATH"
echo "========================================="
echo "You can now cd into that directory and start the system."
