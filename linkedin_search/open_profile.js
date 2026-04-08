#!/usr/bin/env node

const {
  PROFILE_DIR,
  detectLinkedInLoginState,
  getPrimaryPage,
  gotoAndSettle,
  launchPersistentContext,
  parseArgs,
} = require('./lib/browser');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage: node open_profile.js [--headed|--headless] [--url URL]

Open Tars's own persistent Chrome profile with Playwright.
Default URL: https://www.linkedin.com/feed/
`);
    return;
  }

  const headed = args.headless ? false : true;
  const targetUrl = args.url || 'https://www.linkedin.com/feed/';
  const context = await launchPersistentContext({ headed });
  const page = await getPrimaryPage(context);

  await gotoAndSettle(page, targetUrl);
  const loginState = await detectLinkedInLoginState(page);

  console.log(JSON.stringify({
    ok: true,
    action: 'open_profile',
    profileDir: PROFILE_DIR,
    url: page.url(),
    requestedUrl: targetUrl,
    loginState,
    note: 'Leave this window open to complete one-time sign-in. Close the browser or press Ctrl+C when done.',
  }, null, 2));

  const shutdown = async () => {
    await context.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    action: 'open_profile',
    error: error.message,
  }, null, 2));
  process.exit(1);
});
