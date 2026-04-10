# Tars Workspace

Tars is a job-search and CV-tailoring workspace for OpenClaw.

The workspace is built around two repeatable loops:

- **LinkedIn discovery:** open a dedicated browser profile, run saved searches, rank recent roles, and store machine-friendly results.
- **CV tailoring:** build the base LaTeX CV, generate per-role PDF variants, and attach those variants back into chat replies when needed.
- **Application lifecycle:** persist job/application history in Postgres, discover apply flows, queue approvals, run approved Easy Apply submissions, render a local dashboard, and generate daily summaries.

This repo is meant to be portable across OpenClaw instances. It avoids hardcoding secrets and keeps local configuration in `.env`.

## What This Workspace Does

- runs autonomous LinkedIn searches with a persistent browser profile
- saves structured job results for ranking and follow-up
- persists job/application lifecycle state in Postgres
- maintains a separate LaTeX CV repository
- generates one tailored CV PDF per shortlisted role
- exposes a local dashboard for approvals and history
- prepares daily summary emails
- supports outbound file attachments by emitting `MEDIA:<absolute-path>` lines in replies

## Repository Layout

```text
.
├── AGENTS.md
├── TOOLS.md
├── CV_WORKFLOW.md
├── .env.example
├── lifecycle/
│   ├── dashboard.js
│   ├── migrate.js
│   ├── search_batch.js
│   ├── send_daily_summary.js
│   ├── submit_approved.js
│   ├── watchdog.js
│   └── migrations/
├── scripts/
│   ├── tars-linkedin-browser.sh
│   ├── tars-linkedin-search.sh
│   ├── tars-cv-status.sh
│   ├── tars-cv-build.sh
│   ├── tars-cv-commit-push.sh
│   ├── tars-cv-variants.sh
│   ├── tars-lifecycle-migrate.sh
│   ├── tars-lifecycle-search-batch.sh
│   ├── tars-lifecycle-submit-approved.sh
│   ├── tars-lifecycle-summary.sh
│   └── tars-lifecycle-dashboard.sh
├── linkedin_search/
│   ├── package.json
│   ├── open_profile.js
│   ├── search_jobs.js
│   ├── search_profile.json
│   └── README.md
└── cv_variants/
    ├── generate_variants.js
    └── README.md
```

## Stack And Dependencies

System dependencies:

- `bash`
- `node` and `npm`
- `git`
- `jq`
- a Chrome/Chromium executable
- `latexmk` or `pdflatex` for CV builds

Node dependencies:

- `dotenv`
- `pg`
- `nodemailer`
- `playwright-core`
- `puppeteer-core`

These are installed from the workspace root `package.json` and `linkedin_search/package.json`.

## Fresh Setup

### 1. Put the workspace somewhere stable

Clone or copy this workspace into the agent home you want to use for Tars.

### 2. Install Node dependencies

```bash
npm install

cd linkedin_search
npm install
```

### 3. Create local configuration

Copy the example file:

```bash
cp .env.example .env
```

Suggested `.env` shape:

```bash
# Candidate-specific values
TARS_CANDIDATE_DISPLAY_NAME="Candidate Name"
TARS_CANDIDATE_FILENAME_PREFIX="CANDIDATE_NAME"

# CV repository settings
TARS_CV_REPO_DIR="../cv"
TARS_CV_MAIN_TEX="cv.tex"

# Browser settings
TARS_CHROME_PATH="google-chrome"

# Lifecycle / database / reporting
TARS_LIFECYCLE_DATABASE_URL="postgresql://user:password@localhost:5432/tars_lifecycle"
TARS_LIFECYCLE_DASHBOARD_HOST="127.0.0.1"
TARS_LIFECYCLE_DASHBOARD_PORT="4310"
TARS_LIFECYCLE_SEARCH_BATCH_SIZE="5"
TARS_LIFECYCLE_DISCOVERY_LIMIT="5"
TARS_LIFECYCLE_MAX_APPLICATION_RETRIES="2"
TARS_LIFECYCLE_RUN_TIMEOUT_MINUTES="20"
TARS_LIFECYCLE_STALE_RUN_MINUTES="30"
TARS_LIFECYCLE_SUMMARY_EMAIL_TO="you@example.com"
TARS_LIFECYCLE_SUMMARY_EMAIL_FROM="tars@example.com"
TARS_LIFECYCLE_SUMMARY_SMTP_HOST="smtp.gmail.com"
TARS_LIFECYCLE_SUMMARY_SMTP_PORT="465"
TARS_LIFECYCLE_SUMMARY_SMTP_SECURE="true"
TARS_LIFECYCLE_SUMMARY_SMTP_USER="you@example.com"
TARS_LIFECYCLE_SUMMARY_SMTP_PASS="app-password"
```

Notes:

- `TARS_CANDIDATE_DISPLAY_NAME` is used in generated manifests and metadata.
- `TARS_CANDIDATE_FILENAME_PREFIX` is used in generated PDF filenames.
- `TARS_CV_REPO_DIR` should point to the separate LaTeX CV repository.
- `TARS_LIFECYCLE_DATABASE_URL` is required for the new dashboard/history/application lifecycle.
- daily summary emails are optional; if SMTP settings are missing, the summary job still writes a local report file and stores the record in the database.
- `.env` is intentionally ignored by git.

### 4. Make sure the CV repo exists

Tars expects a separate LaTeX CV repo with a main TeX entrypoint such as `cv.tex`.

### 5. Bootstrap the browser profile once

Open the dedicated browser profile and log into LinkedIn manually:

```bash
./scripts/tars-linkedin-browser.sh --headed
```

After that first login, the search automation can reuse the same profile autonomously.

## OpenClaw Integration

This repo is the **workspace layer**, not the full OpenClaw install.

On a fresh OpenClaw instance you still need to:

- create or point an agent at this workspace
- ensure the agent has shell/exec access
- bind the desired channels in your OpenClaw config
- keep any account logins, tokens, and browser sessions outside version control

This repo does **not** contain:

- channel bindings
- API keys
- account passwords
- provider auth state

Those belong in the outer OpenClaw runtime and local machine setup.

## Common Commands

### LinkedIn

Open or restore the persistent browser profile:

```bash
./scripts/tars-linkedin-browser.sh --headed
```

Run all saved searches:

```bash
./scripts/tars-linkedin-search.sh
```

Run quietly for machine parsing:

```bash
./scripts/tars-linkedin-search.sh --quiet
```

Run one specific search:

```bash
./scripts/tars-linkedin-search.sh --search us-fullstack --limit 5
```

### CV

Inspect the CV repo:

```bash
./scripts/tars-cv-status.sh
```

Build the base PDF:

```bash
./scripts/tars-cv-build.sh
```

Generate per-role CV variants from the latest LinkedIn results:

```bash
./scripts/tars-cv-variants.sh --limit 5
```

Commit and push CV changes:

```bash
./scripts/tars-cv-commit-push.sh --message "Refresh CV for current role cluster" cv.tex cv.pdf
```

### Lifecycle

Run schema migrations:

```bash
./scripts/tars-lifecycle-migrate.sh
```

Run one search/discovery batch:

```bash
./scripts/tars-lifecycle-search-batch.sh
```

This is the main lifecycle entrypoint. It already covers:
- search
- ingest
- CV variant generation
- apply-flow discovery

Submit approved Easy Apply applications:

```bash
./scripts/tars-lifecycle-submit-approved.sh
```

Generate or send the daily summary:

```bash
./scripts/tars-lifecycle-summary.sh
```

## Fresh Session Handoff

For new Tars sessions, start with:

- `AGENTS.md`
- `README.md`
- `RUNBOOK.md`
- `lifecycle/README.md`
- `memory/YYYY-MM-DD.md` for today and yesterday

The short operator playbook lives in [RUNBOOK.md](./RUNBOOK.md).

Run the stale-run watchdog:

```bash
./scripts/tars-lifecycle-watchdog.sh
```

Start the local dashboard:

```bash
./scripts/tars-lifecycle-dashboard.sh
```

## Outputs

LinkedIn search outputs:

- latest results: `linkedin_search/output/latest_jobs.json`
- run history: `linkedin_search/output/runs/`
- debug artifacts: `linkedin_search/output/debug/`

CV variant outputs:

- per-run output: `cv_variants/output/<timestamp>/`
- latest manifest: `cv_variants/output/latest_manifest.json`

Lifecycle outputs:

- local reports: `lifecycle/output/reports/`
- JSON artifacts and debug payloads: `lifecycle/output/artifacts/`
- discovery screenshots/html: `lifecycle/output/discovery/`

## Tailoring Model

The CV variant generator currently uses pragmatic track-based tailoring:

- `platform`
- `fullstack`
- `ai_automation`
- `vision`
- `general`

Today it rewrites:

- `Summary`
- `Skills`

It does **not** yet fully rewrite every experience bullet per role. That can be layered in later if the workflow proves valuable.

## Attachment Behavior

If Tars should send a generated CV back into chat, the reply should include a standalone line like:

```text
MEDIA:<pdfPath from latest manifest>
```

The absolute path comes from the generated manifest. Keep each `MEDIA:` entry on its own line.

## Files To Read

For workspace behavior and operating rules:

- `AGENTS.md`
- `TOOLS.md`
- `CV_WORKFLOW.md`
- `lifecycle/migrations/001_init.sql`
- `linkedin_search/README.md`
- `cv_variants/README.md`

## Notes For Maintainers

- Keep this repo portable. Prefer relative paths in docs and env examples.
- Do not commit `.env`, auth state, browser profiles, or generated output.
- If you want to push this repo publicly, review identity and memory files first.
