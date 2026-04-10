#!/usr/bin/env node

const { applyMigrations, closePool, withTransaction } = require('./lib/db');
const { config } = require('./lib/config');
const {
  APPLICATION_STATUS,
  STEP_NAME,
  WORKER_RUN_STATUS,
} = require('./lib/state');
const {
  createWorkerRun,
  finishWorkerRun,
  insertApplicationStep,
  updateApplicationStatus,
} = require('./lib/repository');

async function findStaleRuns(client) {
  const result = await client.query(
    `SELECT *
    FROM worker_runs
    WHERE status = $1
      AND (
        timeout_at < NOW()
        OR heartbeat_at < NOW() - ($2 || ' minutes')::interval
      )`,
    [WORKER_RUN_STATUS.RUNNING, String(config.staleRunMinutes)],
  );
  return result.rows;
}

async function main() {
  await applyMigrations();

  const watchdogRun = await withTransaction((client) => createWorkerRun(client, {
    kind: 'watchdog',
    timeoutMinutes: 5,
    details: {},
  }));

  try {
    const staleRuns = await withTransaction((client) => findStaleRuns(client));
    let recoveredApplications = 0;

    for (const staleRun of staleRuns) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE worker_runs
          SET status = $2,
              finished_at = NOW(),
              heartbeat_at = NOW(),
              error_class = 'stale_run',
              error_message = 'Watchdog marked this run as stale'
          WHERE id = $1`,
          [staleRun.id, WORKER_RUN_STATUS.FAILED],
        );

        const affectedApplications = await client.query(
          `SELECT id, status
          FROM applications
          WHERE last_worker_run_id = $1
            AND status NOT IN ($2, $3, $4)`,
          [
            staleRun.id,
            APPLICATION_STATUS.SUBMITTED,
            APPLICATION_STATUS.SKIPPED,
            APPLICATION_STATUS.DUPLICATE,
          ],
        );

        for (const application of affectedApplications.rows) {
          recoveredApplications += 1;
          await updateApplicationStatus(client, application.id, {
            status: APPLICATION_STATUS.FAILED,
            lastError: `Watchdog marked worker run ${staleRun.id} as stale`,
            workerRunId: watchdogRun.id,
          });
          await insertApplicationStep(
            client,
            application.id,
            watchdogRun.id,
            STEP_NAME.WATCHDOG,
            APPLICATION_STATUS.FAILED,
            {
              staleWorkerRunId: staleRun.id,
            },
          );
        }
      });
    }

    const summary = {
      ok: true,
      action: 'watchdog',
      workerRunId: watchdogRun.id,
      staleRuns: staleRuns.length,
      recoveredApplications,
    };

    await withTransaction(async (client) => {
      await finishWorkerRun(client, watchdogRun.id, {
        status: WORKER_RUN_STATUS.SUCCEEDED,
        details: summary,
      });
    });

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await withTransaction(async (client) => {
      await finishWorkerRun(client, watchdogRun.id, {
        status: WORKER_RUN_STATUS.FAILED,
        errorClass: 'watchdog',
        errorMessage: error.message,
        details: {
          stack: error.stack,
        },
      });
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    action: 'watchdog',
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
