#!/usr/bin/env node

const path = require('path');
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
  buildJobDedupeKey,
  runCommand,
  writeJsonArtifact,
} = require('./lib/utils');
const {
  createWorkerRun,
  heartbeatWorkerRun,
  finishWorkerRun,
  createArtifact,
  upsertJob,
  updateJobAvailability,
  insertJobRun,
  upsertApplication,
  updateApplicationStatus,
  insertApplicationStep,
  setApprovalState,
} = require('./lib/repository');
const { discoverApplicationFlow } = require('./lib/application-discovery');

function parseArgs(argv) {
  const args = {
    limit: config.searchBatchSize,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit') {
      args.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--headed') {
      args.headed = true;
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive integer');
  }

  return args;
}

function logPhase(message) {
  const stamp = new Date().toISOString();
  console.error(`[${stamp}] ${message}`);
}

function decideApplicationOutcome(discovery) {
  if (!discovery.ok) {
    return {
      status: APPLICATION_STATUS.FAILED,
      approvalState: APPROVAL_STATE.NONE,
    };
  }

  if (discovery.flowType === FLOW_TYPE.NO_APPLY_PATH) {
    return {
      status: APPLICATION_STATUS.SKIPPED,
      approvalState: APPROVAL_STATE.NONE,
    };
  }

  if (
    discovery.flowType === FLOW_TYPE.EASY_APPLY_NATIVE &&
    discovery.readiness === 'ready_for_approval'
  ) {
    return {
      status: APPLICATION_STATUS.PENDING_APPROVAL,
      approvalState: APPROVAL_STATE.PENDING,
    };
  }

  if (discovery.readiness === 'needs_human_input') {
    return {
      status: APPLICATION_STATUS.NEEDS_HUMAN_INPUT,
      approvalState: APPROVAL_STATE.NONE,
    };
  }

  return {
    status: APPLICATION_STATUS.FAILED,
    approvalState: APPROVAL_STATE.NONE,
  };
}

async function runLinkedInSearch({ headed = false } = {}) {
  const args = [
    path.join(config.workspaceRoot, 'linkedin_search', 'search_jobs.js'),
  ];
  if (headed) {
    args.push('--headed');
  }
  const { stdout } = await runCommand(process.execPath, args, {
    streamStderr: true,
  });
  return JSON.parse(stdout);
}

async function generateCvVariants(shortlistPath, limit) {
  const { stdout } = await runCommand(process.execPath, [
    path.join(config.workspaceRoot, 'cv_variants', 'generate_variants.js'),
    '--input',
    shortlistPath,
    '--limit',
    String(limit),
    '--quiet',
  ]);
  return JSON.parse(stdout);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await applyMigrations();

  const workerRun = await withTransaction((client) => createWorkerRun(client, {
    kind: 'search_batch',
    timeoutMinutes: config.runTimeoutMinutes,
    details: {
      limit: args.limit,
      headed: args.headed,
    },
  }));

  try {
    await withTransaction((client) => heartbeatWorkerRun(client, workerRun.id, {
      phase: 'search_started',
      limit: args.limit,
    }));
    logPhase('Starting LinkedIn search batch');
    const searchReport = await runLinkedInSearch({ headed: args.headed });
    const searchArtifactPath = writeJsonArtifact('search-runs', searchReport, {
      fileSuffix: 'linkedin-search',
    });

    await withTransaction(async (client) => {
      await heartbeatWorkerRun(client, workerRun.id, {
        phase: 'search_complete',
        resultCount: searchReport.resultCount || 0,
      });
      await createArtifact(client, {
        entityType: 'worker_run',
        entityId: workerRun.id,
        kind: 'linkedin_search_report',
        filePath: searchArtifactPath,
        mimeType: 'application/json',
        metadata: {
          resultCount: searchReport.resultCount || 0,
        },
      });
    });

    const shortlist = [];
    await withTransaction(async (client) => {
      for (const result of searchReport.results || []) {
        const dedupeKey = buildJobDedupeKey(result);
        const job = await upsertJob(client, result, workerRun.id, dedupeKey);
        await insertJobRun(client, job.id, workerRun.id, result, {
          postedTime: result.postedTime || null,
        });

        const existingApplication = await client.query(
          'SELECT * FROM applications WHERE job_id = $1',
          [job.id],
        );
        if (shortlist.length >= args.limit) continue;

        if (existingApplication.rowCount === 0) {
          const application = await upsertApplication(client, {
            jobId: job.id,
            status: APPLICATION_STATUS.RANKED,
            approvalState: APPROVAL_STATE.NONE,
            workerRunId: workerRun.id,
            draftPayload: {
              source: 'search_batch',
            },
          });
          await insertApplicationStep(
            client,
            application.id,
            workerRun.id,
            STEP_NAME.INGEST,
            APPLICATION_STATUS.RANKED,
            { reason: 'new_candidate' },
          );
          shortlist.push({ job, jobPayload: result, application });
          continue;
        }

        const existing = existingApplication.rows[0];
        if (
          existing.status === APPLICATION_STATUS.FAILED &&
          existing.retry_count < config.maxApplicationRetries
        ) {
          shortlist.push({ job, jobPayload: result, application: existing });
        }
      }
    });

    let manifest = null;
    if (shortlist.length > 0) {
      logPhase(`Generating CV variants for ${shortlist.length} shortlisted jobs`);
      const shortlistPayload = {
        ok: true,
        generatedAt: new Date().toISOString(),
        runLabel: 'shortlist',
        resultCount: shortlist.length,
        results: shortlist.map((item) => item.jobPayload),
      };
      const shortlistPath = writeJsonArtifact('shortlists', shortlistPayload, {
        fileSuffix: `run-${workerRun.id}`,
      });
      manifest = await generateCvVariants(shortlistPath, shortlist.length);
      const manifestPath = writeJsonArtifact('cv-manifests', manifest, {
        fileSuffix: `run-${workerRun.id}`,
      });

      await withTransaction(async (client) => {
        await heartbeatWorkerRun(client, workerRun.id, {
          phase: 'cv_variants_complete',
          shortlisted: shortlist.length,
        });
        await createArtifact(client, {
          entityType: 'worker_run',
          entityId: workerRun.id,
          kind: 'shortlist',
          filePath: shortlistPath,
          mimeType: 'application/json',
          metadata: {
            shortlisted: shortlist.length,
          },
        });
        await createArtifact(client, {
          entityType: 'worker_run',
          entityId: workerRun.id,
          kind: 'cv_manifest',
          filePath: manifestPath,
          mimeType: 'application/json',
          metadata: {
            selectedCount: manifest.selectedCount || shortlist.length,
          },
        });
      });
    }

    const discovered = [];
    for (const [index, item] of shortlist.entries()) {
      const variant = manifest?.variants?.[index] || null;
      logPhase(`Discovering application flow ${index + 1}/${shortlist.length}: ${item.job.title || 'Untitled role'} @ ${item.job.company || 'Unknown company'}`);

      await withTransaction(async (client) => {
        await heartbeatWorkerRun(client, workerRun.id, {
          phase: 'discovery',
          currentIndex: index + 1,
          total: shortlist.length,
          jobId: item.job.id,
        });
        const updated = await updateApplicationStatus(client, item.application.id, {
          status: APPLICATION_STATUS.DRAFT_READY,
          approvalState: APPROVAL_STATE.NONE,
          cvVariantPath: variant?.pdfPath || null,
          cvVariantFileName: variant?.fileName || null,
          draftPayload: {
            variantManifestIndex: index,
          },
          workerRunId: workerRun.id,
        });
        item.application = updated;
        await insertApplicationStep(
          client,
          item.application.id,
          workerRun.id,
          STEP_NAME.CV_VARIANT,
          variant?.ok ? APPLICATION_STATUS.DRAFT_READY : APPLICATION_STATUS.FAILED,
          {
            cvVariantPath: variant?.pdfPath || null,
            cvVariantFileName: variant?.fileName || null,
          },
        );
        if (variant?.pdfPath) {
          await createArtifact(client, {
            entityType: 'application',
            entityId: item.application.id,
            kind: 'cv_variant_pdf',
            filePath: variant.pdfPath,
            mimeType: 'application/pdf',
            metadata: {
              fileName: variant.fileName,
            },
          });
        }
      });

      const discovery = await discoverApplicationFlow(item.jobPayload, {
        headed: args.headed,
      });
      const outcome = decideApplicationOutcome(discovery);
      discovered.push({
        applicationId: item.application.id,
        jobId: item.job.id,
        outcome,
        discovery,
      });

      await withTransaction(async (client) => {
        await updateJobAvailability(client, item.job.id, {
          isActive: discovery.jobActive !== false,
          reason: discovery.inactiveReason || discovery.reason || null,
        });
        const updated = await updateApplicationStatus(client, item.application.id, {
          status: outcome.status,
          approvalState: outcome.approvalState,
          flowType: discovery.flowType,
          externalApplyUrl: discovery.externalUrl || null,
          draftPayload: {
            loginState: discovery.loginState || null,
            buttons: discovery.buttons || [],
            reason: discovery.reason,
          },
          discoveredFields: discovery.fields || [],
          lastError: outcome.status === APPLICATION_STATUS.FAILED ? discovery.reason : null,
          workerRunId: workerRun.id,
        });

        await insertApplicationStep(
          client,
          item.application.id,
          workerRun.id,
          STEP_NAME.DISCOVERY,
          outcome.status,
          {
            flowType: discovery.flowType,
            readiness: discovery.readiness,
            reason: discovery.reason,
            externalUrl: discovery.externalUrl || null,
          },
        );

        if (discovery.artifacts?.screenshotPath) {
          await createArtifact(client, {
            entityType: 'application',
            entityId: updated.id,
            kind: 'discovery_screenshot',
            filePath: discovery.artifacts.screenshotPath,
            mimeType: 'image/png',
            metadata: {
              flowType: discovery.flowType,
            },
          });
        }
        if (discovery.artifacts?.htmlPath) {
          await createArtifact(client, {
            entityType: 'application',
            entityId: updated.id,
            kind: 'discovery_html',
            filePath: discovery.artifacts.htmlPath,
            mimeType: 'text/html',
            metadata: {
              flowType: discovery.flowType,
            },
          });
        }

        if (outcome.approvalState === APPROVAL_STATE.PENDING) {
          await setApprovalState(client, updated.id, {
            state: APPROVAL_STATE.PENDING,
            actor: 'tars-search-batch',
            reason: 'Ready for operator approval',
          });
          await insertApplicationStep(
            client,
            updated.id,
            workerRun.id,
            STEP_NAME.APPROVAL,
            APPLICATION_STATUS.PENDING_APPROVAL,
            {
              actor: 'tars-search-batch',
            },
          );
        }
      });
    }

    const summary = {
      ok: true,
      action: 'search_batch',
      workerRunId: workerRun.id,
      searchResultCount: searchReport.resultCount || 0,
      shortlisted: shortlist.length,
      pendingApproval: discovered.filter((item) => item.outcome.status === APPLICATION_STATUS.PENDING_APPROVAL).length,
      needsHumanInput: discovered.filter((item) => item.outcome.status === APPLICATION_STATUS.NEEDS_HUMAN_INPUT).length,
      failed: discovered.filter((item) => item.outcome.status === APPLICATION_STATUS.FAILED).length,
    };

    await withTransaction(async (client) => {
      await finishWorkerRun(client, workerRun.id, {
        status: WORKER_RUN_STATUS.SUCCEEDED,
        details: summary,
      });
    });

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await withTransaction(async (client) => {
      await finishWorkerRun(client, workerRun.id, {
        status: WORKER_RUN_STATUS.FAILED,
        errorClass: 'search_batch',
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
    action: 'search_batch',
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
