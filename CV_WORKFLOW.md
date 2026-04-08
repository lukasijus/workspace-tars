# CV_WORKFLOW.md

This workspace is also responsible for maintaining the candidate's LaTeX CV repo.

## Repository

- Repo path: `$TARS_CV_REPO_DIR`
- Main source file: `$TARS_CV_MAIN_TEX`
- Primary build artifact: `cv.pdf`

## Scope

Use this repo when the human asks to:

- update CV content
- tailor the CV to current job searches
- keep the CV fresh for current role targets
- rebuild the PDF
- commit or push CV-related changes

Do not assume CV work by default. CV is a separate lane from `mlv1sion`.

## Rules

- Treat `$TARS_CV_REPO_DIR` as an approved working repo for Tars.
- The human has pre-approved CV-related maintenance in this repo, including:
  - editing content
  - rebuilding the PDF
  - committing changes
  - pushing CV-related commits to `origin`
- Do not revert unrelated existing changes in the repo.
- Check `git status` first because the repo may already be dirty.
- Prefer small, intentional commits with explicit messages.

## Helper commands

- Config:
  - copy `.env.example` to `.env` and set candidate/repo values
- Status:
  - `scripts/tars-cv-status.sh`
- Build:
  - `scripts/tars-cv-build.sh`
- Generate tailored per-role CV PDFs in Tars's workspace:
  - `scripts/tars-cv-variants.sh --limit 5`
- Commit and optionally push:
  - `scripts/tars-cv-commit-push.sh --message "..." --all`

## Workflow

1. Inspect current CV repo state.
2. Edit `cv.tex` or related files.
3. Build the PDF.
4. Review git diff/status.
5. Commit and push if the change is clearly CV-related.

For shortlist work:

1. Run LinkedIn search.
2. Generate CV variants from the latest shortlist into Tars's workspace.
3. Review the manifest and PDFs.
4. Attach the matching PDF when replying with the job list by including a standalone `MEDIA:<absolute-pdf-path>` line in the outbound reply.

## Notes

- The repo currently tracks generated LaTeX artifacts too. Do not assume only `cv.tex` changes matter.
- If the CV needs tailoring for a specific role cluster, align wording with the active LinkedIn search direction rather than stuffing generic buzzwords.
- Tailored role-specific PDFs should be generated in Tars's workspace, not committed back into `$TARS_CV_REPO_DIR` unless the human explicitly wants the base CV changed.
- Generated PDFs in the Tars workspace are valid outbound attachment sources for WhatsApp replies; use the manifest `pdfPath` values directly.
