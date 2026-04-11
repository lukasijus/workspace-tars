# CV Variants

This workflow generates tailored CV variants from the base LaTeX CV configured in `.env`.

## Goal

For a shortlist of jobs, produce one PDF per role in Tars's workspace so the outbound shortlist reply can include a matching attachment for each item.

Example filenames:

- `CANDIDATE_COMPANY_NAME_ROLE_IN_THE_COMPANY.pdf`
- `CANDIDATE_OPENAI_LEAD_AI_ENGINEER.pdf`

## Inputs

- Base CV source: `$TARS_CV_REPO_DIR/$TARS_CV_MAIN_TEX`
- Job list JSON: usually `linkedin_search/output/latest_jobs.json`

## Output

Each run writes into:

- `cv_variants/output/<timestamp>/`

Artifacts:

- one `.tex` file per job
- one `.pdf` file per job
- `manifest.json` with job metadata, chosen track, and output paths

Latest manifest is also copied to:

- `cv_variants/output/latest_manifest.json`

## Configuration

Copy `.env.example` to `.env` and adjust:

- `TARS_CANDIDATE_DISPLAY_NAME`
- `TARS_CANDIDATE_FILENAME_PREFIX`
- `TARS_CV_REPO_DIR`
- `TARS_CV_MAIN_TEX`

## Current tailoring strategy

This is intentionally pragmatic, not magical.

The generator currently:

- classifies each role into a rough track:
  - `platform`
  - `fullstack`
  - `ai_automation`
  - `vision`
  - `general`
- rewrites the `Summary` section to fit that track
- rewrites the `Skills` section to emphasize the most relevant areas
- uses lifecycle keyword extraction when available to add truthful role-specific match signals

It does **not** yet fully rewrite experience bullets per company/role. That can be layered on later if it proves useful.

## Entrypoint

Use the wrapper:

- `scripts/tars-cv-variants.sh`

Typical usage:

```bash
./scripts/tars-cv-variants.sh --limit 5
```

Single-result example:

```bash
./scripts/tars-cv-variants.sh --job-index 0
```

## Notes

- Treat these as tailored starting points, not final hand-crafted applications.
- For high-value applications, review the generated diff before sending.
- Output filenames are sanitized and may add a suffix if company/title collisions occur.
