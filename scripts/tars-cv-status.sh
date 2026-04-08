#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/tars-env.sh"

REPO="$TARS_CV_REPO_DIR"

command -v git >/dev/null 2>&1 || {
  jq -n --arg error "Missing required command: git" '{ok:false,error:$error}'
  exit 1
}

cd "$REPO"

branch="$(git rev-parse --abbrev-ref HEAD)"
head_sha="$(git rev-parse HEAD)"
head_subject="$(git log -1 --pretty=%s)"

status_lines_json="$(
  git status --short | jq -R -s '
    split("\n")
    | map(select(length > 0))
    | map({
        code: .[0:2],
        path: (.[3:] | sub("^\""; "") | sub("\"$"; ""))
      })
  '
)"

jq -n \
  --arg repo "$REPO" \
  --arg branch "$branch" \
  --arg headSha "$head_sha" \
  --arg headSubject "$head_subject" \
  --arg remote "$(git remote get-url origin 2>/dev/null || true)" \
  --argjson status "$status_lines_json" \
  '{
    ok: true,
    repo: $repo,
    branch: $branch,
    headSha: $headSha,
    headSubject: $headSubject,
    remote: (if $remote == "" then null else $remote end),
    dirty: ($status | length > 0),
    status: $status
  }'
