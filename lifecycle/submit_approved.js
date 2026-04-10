#!/usr/bin/env node

const { applyMigrations, closePool, withTransaction } = require('./lib/db');
const { config } = require('./lib/config');
const {
  APPLICATION_STATUS,
  APPROVAL_STATE,
  STEP_NAME,
  WORKER_RUN_STATUS,
  FLOW_TYPE,
} = require('./lib/state');
const {
  createWorkerRun,
  heartbeatWorkerRun,
  finishWorkerRun,
  createArtifact,
  findApprovedApplications,
  updateJobAvailability,
  updateApplicationStatus,
  insertApplicationStep,
} = require('./lib/repository');
const { submitEasyApply } = require('./lib/application-discovery');
const { submitExternalCustom } = require('./lib/external-apply');

async function runSubmitApproved(options = {}) {
  await applyMigrations();
  const applicationIds = Array.isArray(options.applicationIds)
    ? options.applicationIds.map((value) => Number(value)).filter(Number.isInteger)
    : [];
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : applicationIds.length || config.searchBatchSize;

  const workerRun = await withTransaction((client) => createWorkerRun(client, {
    kind: 'submit_approved',
    timeoutMinutes: config.runTimeoutMinutes,
    details: {
      source: options.source || 'cli',
      applicationIds,
    },
  }));

  try {
    const applications = await withTransaction((client) => findApprovedApplications(
      client,
      limit,
      applicationIds,
    ));

    const summary = {
      ok: true,
      action: 'submit_approved',
      workerRunId: workerRun.id,
      attempted: 0,
      submitted: 0,
      needsHumanInput: 0,
      failed: 0,
      deferred: 0,
      scope: applicationIds.length ? 'selected' : 'all_approved',
      selectedApplicationIds: applicationIds,
    };

    for (const application of applications) {
      summary.attempted += 1;
      await withTransaction((client) => heartbeatWorkerRun(client, workerRun.id, {
        phase: 'submit',
        applicationId: application.id,
      }));

      let submission;
      if (application.flow_type === FLOW_TYPE.EASY_APPLY_NATIVE) {
        submission = await submitEasyApply(application, application, { headed: false });
      } else if (application.flow_type === FLOW_TYPE.EXTERNAL_CUSTOM) {
        submission = await submitExternalCustom(application, application, { headed: false });
      } else {
        await withTransaction(async (client) => {
          await updateApplicationStatus(client, application.id, {
            status: APPLICATION_STATUS.NEEDS_HUMAN_INPUT,
            approvalState: APPROVAL_STATE.APPROVED,
            lastError: 'External application flow still requires manual completion in v1',
            workerRunId: workerRun.id,
          });
          await insertApplicationStep(
            client,
            application.id,
            workerRun.id,
            STEP_NAME.SUBMIT,
            APPLICATION_STATUS.NEEDS_HUMAN_INPUT,
            { reason: 'external_flow_manual_only' },
          );
        });
        summary.needsHumanInput += 1;
        continue;
      }

      await withTransaction(async (client) => {
        await updateJobAvailability(client, application.job_id, {
          isActive: submission.jobActive !== false,
          reason: submission.inactiveReason || submission.reason || null,
        });

        if (submission.artifacts?.screenshotPath) {
          await createArtifact(client, {
            entityType: 'application',
            entityId: application.id,
            kind: 'submission_screenshot',
            filePath: submission.artifacts.screenshotPath,
            mimeType: 'image/png',
            metadata: {
              errorClass: submission.errorClass || null,
            },
          });
        }
        if (submission.artifacts?.htmlPath) {
          await createArtifact(client, {
            entityType: 'application',
            entityId: application.id,
            kind: 'submission_html',
            filePath: submission.artifacts.htmlPath,
            mimeType: 'text/html',
            metadata: {
              errorClass: submission.errorClass || null,
            },
          });
        }

        if (submission.ok && submission.status === 'submitted') {
          await updateApplicationStatus(client, application.id, {
            status: APPLICATION_STATUS.SUBMITTED,
            approvalState: APPROVAL_STATE.APPROVED,
            workerRunId: workerRun.id,
            markSubmissionAttempted: true,
            markSubmitted: true,
            lastError: null,
          });
          await insertApplicationStep(
            client,
            application.id,
            workerRun.id,
            STEP_NAME.SUBMIT,
            APPLICATION_STATUS.SUBMITTED,
            { reason: submission.reason },
          );
          summary.submitted += 1;
          return;
        }

        if (submission.status === 'skipped' && submission.errorClass === 'inactive') {
          await updateApplicationStatus(client, application.id, {
            status: APPLICATION_STATUS.SKIPPED,
            approvalState: APPROVAL_STATE.NONE,
            workerRunId: workerRun.id,
            markSubmissionAttempted: true,
            lastError: submission.reason,
          });
          await insertApplicationStep(
            client,
            application.id,
            workerRun.id,
            STEP_NAME.SUBMIT,
            APPLICATION_STATUS.SKIPPED,
            {
              reason: submission.reason,
              errorClass: submission.errorClass,
            },
          );
          summary.failed += 1;
          return;
        }

        if (submission.status === 'needs_human_input') {
          await updateApplicationStatus(client, application.id, {
            status: APPLICATION_STATUS.NEEDS_HUMAN_INPUT,
            approvalState: APPROVAL_STATE.APPROVED,
            workerRunId: workerRun.id,
            markSubmissionAttempted: true,
            lastError: submission.reason,
            discoveredFields: submission.step || submission.fields || [],
            draftPayload: {
              externalStep: submission.step || null,
            },
          });
          await insertApplicationStep(
            client,
            application.id,
            workerRun.id,
            STEP_NAME.SUBMIT,
            APPLICATION_STATUS.NEEDS_HUMAN_INPUT,
            {
              reason: submission.reason,
              fields: submission.fields || [],
              step: submission.step || null,
            },
          );
          summary.needsHumanInput += 1;
          return;
        }

        const nextRetryCount = application.retry_count + 1;
        const canRetry = submission.errorClass === 'browser_closed'
          && nextRetryCount < config.maxApplicationRetries;

        await updateApplicationStatus(client, application.id, {
          status: canRetry ? APPLICATION_STATUS.APPROVED : APPLICATION_STATUS.FAILED,
          approvalState: APPROVAL_STATE.APPROVED,
          workerRunId: workerRun.id,
          retryCount: nextRetryCount,
          markSubmissionAttempted: true,
          lastError: submission.reason,
        });
        await insertApplicationStep(
          client,
          application.id,
          workerRun.id,
          STEP_NAME.SUBMIT,
          canRetry ? APPLICATION_STATUS.APPROVED : APPLICATION_STATUS.FAILED,
          {
            reason: submission.reason,
            errorClass: submission.errorClass || null,
            retryCount: nextRetryCount,
            step: submission.step || null,
          },
        );

        if (canRetry) {
          summary.deferred += 1;
        } else {
          summary.failed += 1;
        }
      });
    }

    await withTransaction(async (client) => {
      await finishWorkerRun(client, workerRun.id, {
        status: WORKER_RUN_STATUS.SUCCEEDED,
        details: summary,
      });
    });

    return summary;
  } catch (error) {
    await withTransaction(async (client) => {
      await finishWorkerRun(client, workerRun.id, {
        status: WORKER_RUN_STATUS.FAILED,
        errorClass: 'submit_approved',
        errorMessage: error.message,
        details: {
          stack: error.stack,
        },
      });
    });
    throw error;
  }
}

async function main() {
  const summary = await runSubmitApproved();
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      action: 'submit_approved',
      error: error.message,
    }, null, 2));
    process.exitCode = 1;
  }).finally(async () => {
    await closePool().catch(() => {});
  });
}

module.exports = {
  runSubmitApproved,
};
