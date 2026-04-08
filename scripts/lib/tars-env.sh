#!/usr/bin/env bash

if [[ -n "${_TARS_ENV_SH_LOADED:-}" ]]; then
  return 0
fi
_TARS_ENV_SH_LOADED=1

TARS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARS_SCRIPTS_DIR="$(cd "$TARS_LIB_DIR/.." && pwd)"
TARS_WORKSPACE_ROOT="${TARS_WORKSPACE_ROOT:-$(cd "$TARS_SCRIPTS_DIR/.." && pwd)}"
export TARS_WORKSPACE_ROOT

TARS_ENV_FILE="${TARS_ENV_FILE:-$TARS_WORKSPACE_ROOT/.env}"
export TARS_ENV_FILE

if [[ -f "$TARS_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$TARS_ENV_FILE"
  set +a
fi

: "${TARS_CV_REPO_DIR:=$HOME/cv}"
: "${TARS_CV_MAIN_TEX:=cv.tex}"
: "${TARS_CANDIDATE_DISPLAY_NAME:=Candidate Name}"
: "${TARS_CANDIDATE_FILENAME_PREFIX:=CANDIDATE}"
: "${TARS_CHROME_PATH:=/usr/bin/google-chrome}"

export TARS_CV_REPO_DIR
export TARS_CV_MAIN_TEX
export TARS_CANDIDATE_DISPLAY_NAME
export TARS_CANDIDATE_FILENAME_PREFIX
export TARS_CHROME_PATH
