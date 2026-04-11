#!/usr/bin/env node

const {
  DEBUG_DIR,
  OUTPUT_DIR,
  PROFILE_DIR,
  buildLinkedInJobsUrl,
  computeFitScore,
  detectLinkedInLoginState,
  getPrimaryPage,
  gotoAndSettle,
  launchPersistentContext,
  loadSearchProfile,
  logProgress,
  nowStamp,
  parseArgs,
  saveRunReport,
} = require('./lib/browser');

async function scrollSearchResults(page) {
  const selectors = [
    '.jobs-search-results-list',
    '.scaffold-layout__list-container',
    '.scaffold-layout__list',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      for (let index = 0; index < 6; index += 1) {
        await locator.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        }).catch(() => {});
        await page.waitForTimeout(1200);
      }
      return;
    }
  }

  for (let index = 0; index < 6; index += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
  }
}

async function extractJobCards(page, searchName, searchUrl) {
  return page.evaluate(({ searchName, searchUrl }) => {
    const normalizeText = (value) => {
      if (!value) return null;
      let text = value.replace(/\s+/g, ' ').trim();
      text = text.replace(/\s+with verification$/i, '');
      const repeatedPhraseMatch = text.match(/^(.+?)\s+\1$/i);
      if (repeatedPhraseMatch) {
        text = repeatedPhraseMatch[1].trim();
      }
      const half = Math.floor(text.length / 2);
      if (text.length % 2 === 0 && text.slice(0, half) === text.slice(half)) {
        text = text.slice(0, half).trim();
      }
      return text;
    };

    const firstText = (root, selectors) => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        const text = node?.textContent?.trim();
        if (text) return normalizeText(text);
      }
      return null;
    };

    const firstHref = (root, selectors) => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        const href = node?.href;
        if (href) {
          return new URL(href, window.location.origin).toString();
        }
      }
      return null;
    };

    const cards = Array.from(document.querySelectorAll([
      '.job-card-container',
      '.jobs-search-results-list__list-item',
      '.jobs-search-results__list-item',
      '.scaffold-layout__list-item',
      '.scaffold-layout__list-container li',
      '.jobs-search-results-list li',
    ].join(', '))).filter((node) => node.querySelector('a[href*="/jobs/view/"]'));

    return cards.map((card) => {
      const link = firstHref(card, [
        'a.job-card-list__title--link',
        'a.job-card-container__link',
        '.artdeco-entity-lockup__title a',
        'a[href*="/jobs/view/"]',
      ]);
      const jobIdMatch = link?.match(/\/jobs\/view\/(\d+)/);

      return {
        source: 'linkedin',
        searchName,
        searchUrl,
        jobId: jobIdMatch ? jobIdMatch[1] : null,
        title: firstText(card, [
          '.job-card-list__title--link',
          '.job-card-list__title',
          '.artdeco-entity-lockup__title',
          'strong',
        ]),
        company: firstText(card, [
          '.artdeco-entity-lockup__subtitle',
          '.job-card-container__primary-description',
          '.job-card-container__company-name',
        ]),
        location: firstText(card, [
          '.job-card-container__metadata-item',
          '.job-card-container__metadata-wrapper',
          '.artdeco-entity-lockup__caption',
        ]),
        postedTime: firstText(card, [
          'time',
          '.job-card-container__footer-job-state',
          '.job-card-list__footer-wrapper',
          '.job-card-container__footer-item',
        ]),
        link,
      };
    });
  }, { searchName, searchUrl });
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const deduped = [];

  for (const job of jobs) {
    const key = job.jobId || job.link || `${job.title}|${job.company}|${job.location}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }

  return deduped;
}

async function collectDebugMeta(page) {
  return page.evaluate(() => ({
    title: document.title,
    liJobs: document.querySelectorAll('.jobs-search-results-list li').length,
    scaffoldLi: document.querySelectorAll('.scaffold-layout__list-container li').length,
    jobLinks: document.querySelectorAll('a[href*="/jobs/view/"]').length,
    cards: document.querySelectorAll('.job-card-container').length,
    listItems: document.querySelectorAll('.jobs-search-results__list-item').length,
    bodyPreview: document.body?.innerText?.slice(0, 2000) || '',
  }));
}

async function saveDebugArtifacts(page, searchName) {
  const stamp = nowStamp();
  const base = `${stamp}-${searchName}`;
  const screenshotPath = `${DEBUG_DIR}/${base}.png`;
  const htmlPath = `${DEBUG_DIR}/${base}.html`;

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => null);
  if (html) {
    require('fs').writeFileSync(htmlPath, html);
  }

  return {
    screenshotPath,
    htmlPath,
  };
}

async function expandJobDescription(page) {
  const selectors = [
    'button.jobs-description__footer-button',
    '.jobs-description__footer-button',
    'button[aria-label*="description" i]',
    'button:has-text("Show more")',
    'button:has-text("See more")',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (!(await button.count())) continue;
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    return;
  }
}

async function extractJobDescription(page) {
  return page.evaluate(() => {
    const normalizeText = (value) => String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const selectors = [
      '.jobs-description__content',
      '.jobs-box__html-content',
      '.jobs-description-content__text',
      '#job-details',
      '[class*="jobs-description"]',
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalizeText(node?.innerText || node?.textContent || '');
      if (text.length > 120) {
        return {
          descriptionText: text,
          descriptionHtml: node?.innerHTML || null,
        };
      }
    }

    const bodyText = normalizeText(document.body?.innerText || '');
    return {
      descriptionText: bodyText.length > 120 ? bodyText.slice(0, 20000) : null,
      descriptionHtml: null,
    };
  });
}

async function enrichJobDescriptions(page, jobs, args) {
  if (!jobs.length) return;

  logProgress(`Capturing expanded descriptions for ${jobs.length} top jobs`, args);
  for (const [index, job] of jobs.entries()) {
    if (!job.link) continue;
    logProgress(`Description ${index + 1}/${jobs.length}: ${job.company || 'Unknown company'} — ${job.title || 'Untitled role'}`, args);
    try {
      await gotoAndSettle(page, job.link);
      await expandJobDescription(page);
      const extracted = await extractJobDescription(page);
      job.descriptionText = extracted.descriptionText || null;
      job.descriptionHtml = extracted.descriptionHtml || null;
      job.descriptionFetchedAt = new Date().toISOString();
      job.descriptionSourceUrl = page.url();
      job.descriptionFetchStatus = job.descriptionText ? 'ok' : 'empty';
      if (!job.descriptionText) {
        job.descriptionError = 'No job description text found after opening job detail page';
      }
    } catch (error) {
      job.descriptionFetchStatus = 'failed';
      job.descriptionError = error.message;
      logProgress(`Description capture failed for ${job.jobId || job.link}: ${error.message}`, args);
    }
  }
}

async function scrapeSearch(page, defaults, searchConfig, args) {
  const searchUrl = buildLinkedInJobsUrl(searchConfig, defaults);
  logProgress(`Running LinkedIn search "${searchConfig.name}" -> ${searchUrl}`, args);
  await gotoAndSettle(page, searchUrl);

  const loginState = await detectLinkedInLoginState(page);
  if (loginState !== 'authenticated') {
    throw new Error(`LinkedIn session is not ready (${loginState}). Bootstrap the profile first with scripts/tars-linkedin-browser.sh --headed`);
  }

  await page.waitForSelector('.jobs-search-results-list, .scaffold-layout__list-container', { timeout: 25000 }).catch(() => {});
  await scrollSearchResults(page);
  const jobs = await extractJobCards(page, searchConfig.name, searchUrl);
  const debug = await collectDebugMeta(page);

  let artifacts = null;
  if (jobs.length === 0) {
    artifacts = await saveDebugArtifacts(page, searchConfig.name);
    logProgress(`Search "${searchConfig.name}" returned 0 jobs. Saved debug artifacts to ${artifacts.screenshotPath}`, args);
  } else {
    logProgress(`Search "${searchConfig.name}" yielded ${jobs.length} raw jobs`, args);
  }

  return {
    jobs,
    summary: {
      searchName: searchConfig.name,
      searchUrl,
      loginState,
      rawJobCount: jobs.length,
      debug,
      artifacts,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage: node search_jobs.js [--headed] [--search SEARCH_NAME] [--limit N] [--description-limit N] [--quiet]

Run the saved LinkedIn searches against Tars's dedicated persistent browser profile.
Outputs machine-friendly JSON and saves copies under linkedin_search/output/.
`);
    return;
  }

  const profile = loadSearchProfile();
  const searches = args.search
    ? profile.searches.filter((item) => item.name === args.search)
    : profile.searches;

  if (searches.length === 0) {
    throw new Error(`No LinkedIn search matched "${args.search}"`);
  }

  const context = await launchPersistentContext({ headed: args.headed });
  const page = await getPrimaryPage(context);
  const results = [];
  const searchSummaries = [];

  try {
    logProgress(`Starting LinkedIn search run with ${searches.length} saved searches`, args);
    for (const searchConfig of searches) {
      const { jobs, summary } = await scrapeSearch(page, profile.defaults || {}, searchConfig, args);
      searchSummaries.push(summary);
      for (const job of jobs) {
        const fit = computeFitScore(job, profile.fitKeywords || {});
        results.push({
          ...job,
          fitScore: fit.score,
          matchedStrong: fit.matchedStrong,
          matchedBonus: fit.matchedBonus,
        });
      }
    }

    const deduped = dedupeJobs(results)
      .sort((left, right) => right.fitScore - left.fitScore)
      .slice(0, args.limit || profile.defaults?.limit || 60);

    const descriptionLimit = Number.isInteger(args.descriptionLimit) && args.descriptionLimit > 0
      ? args.descriptionLimit
      : profile.defaults?.descriptionLimit || Math.min(10, deduped.length);
    await enrichJobDescriptions(page, deduped.slice(0, descriptionLimit), args);

    for (const job of deduped) {
      const fit = computeFitScore(job, profile.fitKeywords || {});
      job.fitScore = fit.score;
      job.matchedStrong = fit.matchedStrong;
      job.matchedBonus = fit.matchedBonus;
    }

    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      runLabel: 'linkedin-search',
      profileDir: PROFILE_DIR,
      outputDir: OUTPUT_DIR,
      searchNames: searches.map((item) => item.name),
      searchSummaries,
      resultCount: deduped.length,
      results: deduped,
    };

    const runPath = saveRunReport(report);
    logProgress(`LinkedIn search run complete. Saved ${deduped.length} deduped jobs to ${runPath}`, args);
    console.log(JSON.stringify({
      ...report,
      latestPath: `${OUTPUT_DIR}/latest_jobs.json`,
      runPath,
    }, null, 2));
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    action: 'search_jobs',
    error: error.message,
  }, null, 2));
  process.exit(1);
});
