#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/tars-env.sh"

REPO="$TARS_CV_REPO_DIR"
PUSH=true
STAGE_ALL=false
MESSAGE=""
declare -a PATHS=()

usage() {
  cat <<'EOF'
Usage:
  tars-cv-commit-push.sh --message "..." [--all] [--no-push] [paths...]

Examples:
  tars-cv-commit-push.sh --message "Refresh CV for remote AI roles" --all
  tars-cv-commit-push.sh --message "Tighten summary section" cv.tex cv.pdf

Notes:
  - Requires an explicit commit message.
  - Stages either --all or the provided paths.
  - Pushes to origin/current branch by default; use --no-push to stop after commit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message)
      MESSAGE="${2-}"
      shift 2
      ;;
    --all)
      STAGE_ALL=true
      shift
      ;;
    --no-push)
      PUSH=false
      shift
      ;;
    --push)
      PUSH=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      PATHS+=("$1")
      shift
      ;;
  esac
done

[[ -n "$MESSAGE" ]] || {
  jq -n --arg error "Missing required --message" '{ok:false,error:$error}'
  exit 1
}

cd "$REPO"

if $STAGE_ALL; then
  git add -A -- .
elif [[ ${#PATHS[@]} -gt 0 ]]; then
  git add -- "${PATHS[@]}"
else
  jq -n --arg error "Nothing selected to stage. Use --all or pass explicit paths." '{ok:false,error:$error}'
  exit 1
fi

if git diff --cached --quiet; then
  jq -n \
    --arg repo "$REPO" \
    '{ok:false,repo:$repo,error:"No staged changes to commit"}'
  exit 1
fi

git commit -m "$MESSAGE" >/tmp/tars-cv-commit.log 2>&1 || {
  jq -n \
    --arg repo "$REPO" \
    --arg message "$MESSAGE" \
    --arg details "$(tail -n 60 /tmp/tars-cv-commit.log)" \
    '{ok:false,repo:$repo,message:$message,error:"git commit failed",details:$details}'
  exit 1
}

branch="$(git rev-parse --abbrev-ref HEAD)"
head_sha="$(git rev-parse HEAD)"

if $PUSH; then
  git push origin "$branch" >/tmp/tars-cv-push.log 2>&1 || {
    jq -n \
      --arg repo "$REPO" \
      --arg branch "$branch" \
      --arg headSha "$head_sha" \
      --arg details "$(tail -n 60 /tmp/tars-cv-push.log)" \
      '{ok:false,repo:$repo,branch:$branch,headSha:$headSha,error:"git push failed",details:$details}'
    exit 1
  }
fi

jq -n \
  --arg repo "$REPO" \
  --arg branch "$branch" \
  --arg headSha "$head_sha" \
  --arg message "$MESSAGE" \
  --arg remote "$(git remote get-url origin 2>/dev/null || true)" \
  --argjson pushed "$($PUSH && printf 'true' || printf 'false')" \
  '{
    ok:true,
    repo:$repo,
    branch:$branch,
    headSha:$headSha,
    message:$message,
    pushed:$pushed,
    remote:(if $remote == "" then null else $remote end)
  }'
