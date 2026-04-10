# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Browser Automation

- Dedicated Tars LinkedIn profile: `<workspace-root>/.state/browser-profile`
- One-time bootstrap login: `scripts/tars-linkedin-browser.sh --headed`
- Reopen the same profile later: same command, optionally `--url https://www.linkedin.com/feed/`
- Autonomous saved search run: `scripts/tars-linkedin-search.sh`
- Main lifecycle discovery run: `scripts/tars-lifecycle-search-batch.sh`
- Main lifecycle submit run: `scripts/tars-lifecycle-submit-approved.sh`
- Dashboard: `scripts/tars-lifecycle-dashboard.sh`
- Latest structured output: `linkedin_search/output/latest_jobs.json`
- Search definitions live in: `linkedin_search/search_profile.json`
- Do not rely on the human's live browser session for routine automation. Use the dedicated persistent profile instead.

## CV Repo

- Config file template: `.env.example`
- CV repo: `$TARS_CV_REPO_DIR`
- Main source: `$TARS_CV_REPO_DIR/$TARS_CV_MAIN_TEX`
- Build output: `$TARS_CV_REPO_DIR/cv.pdf`
- Status helper: `scripts/tars-cv-status.sh`
- Build helper: `scripts/tars-cv-build.sh`
- Variant generator: `scripts/tars-cv-variants.sh`
- Commit/push helper: `scripts/tars-cv-commit-push.sh`
- Workflow doc: `CV_WORKFLOW.md`
- Variant output root: `cv_variants/output`
- Latest variant manifest: `cv_variants/output/latest_manifest.json`

## Outbound Attachments

- OpenClaw outbound attachments are sent by including a standalone `MEDIA:<absolute-path-or-url>` line in the reply.
- This works for WhatsApp too, including document/PDF payloads.
- For generated CV variants, use the absolute `pdfPath` from the latest manifest:
  - `cv_variants/output/latest_manifest.json`
- Keep each `MEDIA:` entry on its own line with no extra formatting.
- Example:

```text
Top match: Company — Data Platform Engineer/Architect
Tailored CV attached below.
MEDIA:/absolute/path/to/generated-cv.pdf
```

## Lifecycle Operator Notes

- Fresh-session handoff: `RUNBOOK.md`
- Detailed lifecycle docs: `lifecycle/README.md`
- Search batch already includes ingest + CV variant generation + flow discovery.
- `submit-approved` only acts on rows already moved to `approved`.
- Prefer using the real shell scripts as the interface. Do not invent custom slash commands unless the runtime explicitly supports them.
