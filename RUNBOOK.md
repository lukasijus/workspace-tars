# Tars Runbook

This is the short operational handoff for fresh Tars sessions.

Use this when the task is job search, CV tailoring, or application lifecycle work.

## Current Flow

1. Run LinkedIn search + ingest + CV generation + apply-flow discovery
2. Review the local dashboard
3. If a row is `pending_approval`, approve it from the dashboard
4. Run the submit worker
5. Recheck the dashboard and artifacts
6. If a job is dead or misleading, mark it inactive from the single-item page

## Main Commands

All commands are run from the workspace root.

### Browser bootstrap

```bash
./scripts/tars-linkedin-browser.sh --headed
```

Use this to log into or reopen Tars's dedicated browser profile.

### Search + generate + discovery

```bash
./scripts/tars-lifecycle-search-batch.sh
```

This is the main discovery command. It:
- runs the saved LinkedIn searches
- ingests jobs into Postgres
- generates role-specific CV variants
- discovers apply flows
- updates application statuses

### Dashboard

```bash
./scripts/tars-lifecycle-dashboard.sh
```

Operator UI:
- inspect rows
- approve pending items
- retry discovery
- mark jobs inactive

### Submit approved applications

```bash
./scripts/tars-lifecycle-submit-approved.sh
```

This only works on rows already in:
- `status = approved`
- `approval_state = approved`

### Daily summary

```bash
./scripts/tars-lifecycle-summary.sh
```

### Watchdog

```bash
./scripts/tars-lifecycle-watchdog.sh
```

## Status Meaning

- `needs_human_input`
  The flow is blocked by unresolved questions, provider anti-bot checks, or unsupported behavior.
- `pending_approval`
  Tars believes the application is ready for submission, waiting for human approval.
- `approved`
  Human-approved in the dashboard. Not yet submitted until the submit worker runs.
- `submitted`
  Confirmed submitted.
- `failed`
  Actual runtime failure or unexpected automation failure.
- `skipped`
  Intentionally skipped or marked inactive.

## Current Capabilities

- LinkedIn Easy Apply: working
- External custom flows: best-effort working
- Inactive job detection: working
- Manual inactive flag from single-item page: working
- Detail-page actions now refresh automatically after completion

## Known Constraints

- Some external providers will reject automation with human-verification checks.
- Browser profile locks can still happen if multiple runs try to use the same persistent profile at once.
- Greenhouse and Lever are classified and tracked, but not yet fully auto-submitted here.

## Fresh Session Prompt

If starting a new chat/session with Tars, a good prompt is:

```text
Read AGENTS.md, README.md, RUNBOOK.md, lifecycle/README.md, and memory for today+yesterday. Then tell me the current lifecycle state and what command you plan to run next before executing it.
```

If you want Tars to start the cycle immediately:

```text
Read AGENTS.md, README.md, RUNBOOK.md, lifecycle/README.md, and memory for today+yesterday. Then run ./scripts/tars-lifecycle-search-batch.sh and summarize the resulting statuses.
```

## No Custom Slash Commands Needed

Do not invent custom `/run_this_and_that_file` slash commands unless the host platform explicitly supports and routes them.

Use the real scripts in `scripts/` as the stable interface.
