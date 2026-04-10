const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const LINKEDIN_ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(WORKSPACE_ROOT, '.state');
const PROFILE_DIR = path.join(STATE_DIR, 'browser-profile');
const OUTPUT_DIR = path.join(LINKEDIN_ROOT, 'output');
const RUNS_DIR = path.join(OUTPUT_DIR, 'runs');
const DEBUG_DIR = path.join(OUTPUT_DIR, 'debug');
const LEGACY_LATEST_PATH = path.join(LINKEDIN_ROOT, 'linkedin_jobs.json');
const SEARCH_PROFILE_PATH = path.join(LINKEDIN_ROOT, 'search_profile.json');
const CHROME_PATH = process.env.TARS_CHROME_PATH || '/usr/bin/google-chrome';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureWorkspaceDirs() {
  ensureDir(STATE_DIR);
  ensureDir(PROFILE_DIR);
  ensureDir(OUTPUT_DIR);
  ensureDir(RUNS_DIR);
  ensureDir(DEBUG_DIR);
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function loadSearchProfile() {
  return JSON.parse(fs.readFileSync(SEARCH_PROFILE_PATH, 'utf8'));
}

function nowStamp(date = new Date()) {
  return date.toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
}

function nowLogStamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').replace(/\..+/, 'Z');
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseArgs(argv) {
  const parsed = {
    headed: false,
    headless: false,
    quiet: false,
    limit: null,
    search: null,
    url: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--headed') {
      parsed.headed = true;
      continue;
    }
    if (arg === '--headless') {
      parsed.headless = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--quiet') {
      parsed.quiet = true;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--search') {
      parsed.search = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--url') {
      parsed.url = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return parsed;
}

function logProgress(message, { quiet = false } = {}) {
  if (quiet) return;
  console.error(`[${nowLogStamp()}] ${message}`);
}

async function launchPersistentContext({ headed = false } = {}) {
  ensureWorkspaceDirs();

  if (!fileExists(CHROME_PATH)) {
    throw new Error(`Chrome executable not found at ${CHROME_PATH}`);
  }

  const launchOptions = {
    executablePath: CHROME_PATH,
    headless: !headed,
    viewport: { width: 1440, height: 1024 },
    ignoreHTTPSErrors: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-features=Translate,OptimizationHints',
      '--disable-gpu',
      '--no-default-browser-check',
      '--no-first-run',
      '--start-maximized',
    ],
  };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
    } catch (error) {
      const message = String(error?.message || error);
      const locked = /ProcessSingleton|profile directory.*in use|SingletonLock/i.test(message);
      if (!locked || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }

  throw new Error('Failed to launch persistent browser context');
}

async function getPrimaryPage(context) {
  const existing = context.pages()[0];
  if (existing) return existing;
  return context.newPage();
}

async function gotoAndSettle(page, url, timeout = 60000) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  return page;
}

async function detectLinkedInLoginState(page) {
  const loginInput = page.locator('input[name="session_key"], input[name="username"]');
  if ((await loginInput.count()) > 0) {
    return 'login_required';
  }

  const securityPrompt = page.locator('input[name="pin"], input[name="verification_pin"]');
  if ((await securityPrompt.count()) > 0) {
    return 'challenge';
  }

  if (/\/checkpoint|\/login|\/uas\/login/.test(page.url())) {
    return 'login_required';
  }

  const signedInMarkers = page.locator('nav[aria-label*="Primary"], input[placeholder*="Search"], a[href*="/feed/"]');
  if ((await signedInMarkers.count()) > 0) {
    return 'authenticated';
  }

  return 'unknown';
}

function buildLinkedInJobsUrl(search, defaults = {}) {
  const params = new URLSearchParams();
  params.set('keywords', search.keywords);
  params.set('location', search.location);
  params.set('f_TPR', `r${(search.sinceHours || defaults.sinceHours || 24) * 60 * 60}`);
  params.set('sortBy', search.sortBy || defaults.sortBy || 'DD');

  const workTypes = search.workTypes || defaults.workTypes || [];
  if (workTypes.length > 0) {
    params.set('f_WT', workTypes.join(','));
  }

  const experience = search.experience || defaults.experience || [];
  if (experience.length > 0) {
    params.set('f_E', experience.join(','));
  }

  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function computeFitScore(job, fitKeywords = {}) {
  const haystack = `${job.title} ${job.company} ${job.location}`.toLowerCase();
  const matchedStrong = [];
  const matchedBonus = [];
  let score = 0;

  for (const keyword of fitKeywords.strong || []) {
    if (haystack.includes(keyword.toLowerCase())) {
      matchedStrong.push(keyword);
      score += 10;
    }
  }

  for (const keyword of fitKeywords.bonus || []) {
    if (haystack.includes(keyword.toLowerCase())) {
      matchedBonus.push(keyword);
      score += 3;
    }
  }

  return {
    score,
    matchedStrong,
    matchedBonus,
  };
}

function saveRunReport(report) {
  ensureWorkspaceDirs();
  const stamp = nowStamp(new Date(report.generatedAt));
  const runPath = path.join(RUNS_DIR, `${stamp}-${slugify(report.runLabel || 'linkedin-search')}.json`);
  fs.writeFileSync(runPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest_jobs.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(LEGACY_LATEST_PATH, JSON.stringify(report.results || [], null, 2));
  return runPath;
}

module.exports = {
  CHROME_PATH,
  OUTPUT_DIR,
  DEBUG_DIR,
  PROFILE_DIR,
  RUNS_DIR,
  SEARCH_PROFILE_PATH,
  buildLinkedInJobsUrl,
  computeFitScore,
  detectLinkedInLoginState,
  ensureWorkspaceDirs,
  getPrimaryPage,
  gotoAndSettle,
  launchPersistentContext,
  loadSearchProfile,
  nowStamp,
  nowLogStamp,
  parseArgs,
  logProgress,
  saveRunReport,
  slugify,
};
