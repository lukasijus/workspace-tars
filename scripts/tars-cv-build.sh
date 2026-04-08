#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/tars-env.sh"

REPO="$TARS_CV_REPO_DIR"
MAIN_TEX="$TARS_CV_MAIN_TEX"
PDF_PATH="$REPO/cv.pdf"
COMPILER="auto"

usage() {
  cat <<'EOF'
Usage:
  tars-cv-build.sh [--compiler auto|latexmk|pdflatex]

Builds the LaTeX CV in \$TARS_CV_REPO_DIR and returns machine-friendly JSON.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compiler)
      COMPILER="${2-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      jq -n --arg error "Unknown argument: $1" '{ok:false,error:$error}'
      exit 1
      ;;
  esac
done

choose_compiler() {
  case "$COMPILER" in
    auto)
      if command -v latexmk >/dev/null 2>&1; then
        printf 'latexmk'
      elif command -v pdflatex >/dev/null 2>&1; then
        printf 'pdflatex'
      else
        return 1
      fi
      ;;
    latexmk|pdflatex)
      command -v "$COMPILER" >/dev/null 2>&1 || return 1
      printf '%s' "$COMPILER"
      ;;
    *)
      return 1
      ;;
  esac
}

compiler="$(choose_compiler)" || {
  jq -n \
    --arg compiler "$COMPILER" \
    '{ok:false,error:"No supported LaTeX compiler available",requestedCompiler:$compiler}'
  exit 1
}

cd "$REPO"
build_log="$(mktemp)"
trap 'rm -f "$build_log"' EXIT

start_ts="$(date +%s)"

if [[ "$compiler" == "latexmk" ]]; then
  if ! latexmk -pdf "$MAIN_TEX" >"$build_log" 2>&1; then
    jq -n \
      --arg repo "$REPO" \
      --arg compiler "$compiler" \
      --arg mainTex "$MAIN_TEX" \
      --arg logTail "$(tail -n 60 "$build_log")" \
      '{
        ok:false,
        repo:$repo,
        compiler:$compiler,
        mainTex:$mainTex,
        error:"CV build failed",
        logTail:$logTail
      }'
    exit 1
  fi
else
  if ! pdflatex -interaction=nonstopmode "$MAIN_TEX" >"$build_log" 2>&1; then
    jq -n \
      --arg repo "$REPO" \
      --arg compiler "$compiler" \
      --arg mainTex "$MAIN_TEX" \
      --arg logTail "$(tail -n 60 "$build_log")" \
      '{
        ok:false,
        repo:$repo,
        compiler:$compiler,
        mainTex:$mainTex,
        error:"CV build failed",
        logTail:$logTail
      }'
    exit 1
  fi
fi

end_ts="$(date +%s)"
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
  --arg compiler "$compiler" \
  --arg mainTex "$REPO/$MAIN_TEX" \
  --arg pdfPath "$PDF_PATH" \
  --arg logPath "$REPO/cv.log" \
  --argjson durationSec "$(( end_ts - start_ts ))" \
  --argjson status "$status_lines_json" \
  '{
    ok:true,
    repo:$repo,
    compiler:$compiler,
    mainTex:$mainTex,
    pdfPath:$pdfPath,
    logPath:$logPath,
    durationSec:$durationSec,
    dirty: ($status | length > 0),
    status: $status
  }'
