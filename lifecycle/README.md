# Lifecycle

This directory contains the durable jobs/application lifecycle for Tars.

## Purpose

It turns the existing search + CV tooling into a tracked workflow:

- ingest LinkedIn search results
- dedupe jobs into a database
- generate CV variants for shortlisted roles
- discover application flows
- queue approvals in a local dashboard
- submit approved LinkedIn Easy Apply and supported external custom applications
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
- applicant policy defaults live in `lifecycle/policies/applicant_policy.json`

Optional:

- SMTP settings for daily summary email delivery

## Current v1 boundaries

- The system records **all reachable apply flows** discovered from LinkedIn.
- Automatic submission is implemented for **LinkedIn Easy Apply** and best-effort **external custom** flows that can be completed from the applicant profile/policy.
- External flows that still have unresolved questions remain `needs_human_input` with the latest step snapshot and extracted blockers.
- Greenhouse/Lever are still classified and tracked, but not yet auto-submitted here.
- The dashboard is the operator approval surface.
