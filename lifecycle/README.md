# Lifecycle

This directory contains the durable jobs/application lifecycle for Tars.

## Purpose

It turns the existing search + CV tooling into a tracked workflow:

- ingest LinkedIn search results
- dedupe jobs into a database
- generate CV variants for shortlisted roles
- discover application flows
- queue approvals in a local dashboard
- submit approved LinkedIn Easy Apply applications
- watch for stale runs
- generate daily summary reports and optional emails

## Commands

All normal entrypoints live in `scripts/`:

- `scripts/tars-lifecycle-migrate.sh`
- `scripts/tars-lifecycle-search-batch.sh`
- `scripts/tars-lifecycle-submit-approved.sh`
- `scripts/tars-lifecycle-summary.sh`
- `scripts/tars-lifecycle-watchdog.sh`
- `scripts/tars-lifecycle-dashboard.sh`

## Requirements

- `TARS_LIFECYCLE_DATABASE_URL` must be configured
- LinkedIn browser profile must already be bootstrapped
- CV generation should already be working

Optional:

- SMTP settings for daily summary email delivery

## Current v1 boundaries

- The system records **all reachable apply flows** discovered from LinkedIn.
- Automatic submission is implemented only for **LinkedIn Easy Apply** flows that do not require extra unanswered fields.
- External ATS flows are classified and tracked, but remain `needs_human_input` in v1.
- The dashboard is the operator approval surface.
