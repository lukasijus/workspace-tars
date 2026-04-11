# LinkedIn Search

Tars owns this browser flow. It does not attach to the human's live Chrome session.

## One-time bootstrap

Open Tars's dedicated persistent Chrome profile and complete LinkedIn sign-in:

```bash
/home/luk/.openclaw/workspace-tars/scripts/tars-linkedin-browser.sh --headed
```

That profile is stored in:

```text
/home/luk/.openclaw/workspace-tars/.state/browser-profile
```

Once LinkedIn is logged in there, the same profile can be reopened and reused by automation.

## Run searches

Run all saved searches:

```bash
/home/luk/.openclaw/workspace-tars/scripts/tars-linkedin-search.sh
```

Run quietly when another tool will parse the JSON:

```bash
/home/luk/.openclaw/workspace-tars/scripts/tars-linkedin-search.sh --quiet
```

Run one search headed:

```bash
/home/luk/.openclaw/workspace-tars/scripts/tars-linkedin-search.sh --headed --search us-fullstack
```

## Outputs

- Latest run: `linkedin_search/output/latest_jobs.json`
- Timestamped runs: `linkedin_search/output/runs/*.json`
- Empty-search debug artifacts: `linkedin_search/output/debug/`
- Legacy flat array for older tooling: `linkedin_search/linkedin_jobs.json`

## Saved search profile

Edit `search_profile.json` to tune:

- target titles
- regions
- remote vs hybrid filters
- freshness window
- fit keywords
- expanded-description capture limit (`defaults.descriptionLimit`)

## Notes

- The scripts use Playwright with a persistent Chrome profile.
- The first login is human-assisted once. After that, Tars can relaunch the same profile on his own.
- If LinkedIn expires the session or triggers a challenge, rerun the browser helper in headed mode and solve it there.
- Search runs log progress to stderr by default and keep final JSON on stdout.
- Lifecycle runs pass `--description-limit` for the current shortlist window so top jobs get expanded descriptions without opening every search result.
