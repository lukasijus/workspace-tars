#!/usr/bin/env node

const { applyMigrations, closePool } = require('./lib/db');

async function main() {
  await applyMigrations();
  console.log(JSON.stringify({
    ok: true,
    action: 'migrate',
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    action: 'migrate',
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
