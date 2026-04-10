#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { applyMigrations, closePool, query, withTransaction } = require('./lib/db');
const { config } = require('./lib/config');
const {
  createWorkerRun,
  finishWorkerRun,
  upsertDailySummary,
} = require('./lib/repository');
const { WORKER_RUN_STATUS } = require('./lib/state');
const { ensureDir, stampForFile } = require('./lib/utils');

async function collectSummaryRows() {
  const [counts, pending, submitted, failed] = await Promise.all([
    query(
      `SELECT status, COUNT(*)::int AS count
      FROM applications
      GROUP BY status`,
    ),
    query(
      `SELECT jobs.company, jobs.title, jobs.location, jobs.source_url, applications.updated_at
      FROM applications
      JOIN jobs ON jobs.id = applications.job_id
      WHERE applications.status = 'pending_approval'
      ORDER BY jobs.latest_fit_score DESC, jobs.latest_seen_at DESC
      LIMIT 10`,
    ),
    query(
      `SELECT jobs.company, jobs.title, jobs.location, applications.submitted_at
      FROM applications
      JOIN jobs ON jobs.id = applications.job_id
      WHERE applications.submitted_at::date = CURRENT_DATE
      ORDER BY applications.submitted_at DESC
      LIMIT 10`,
    ),
    query(
      `SELECT jobs.company, jobs.title, jobs.location, applications.last_error, applications.updated_at
      FROM applications
      JOIN jobs ON jobs.id = applications.job_id
      WHERE applications.status = 'failed'
        AND applications.updated_at::date = CURRENT_DATE
      ORDER BY applications.updated_at DESC
      LIMIT 10`,
    ),
  ]);

  return {
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
    pending: pending.rows,
    submitted: submitted.rows,
    failed: failed.rows,
  };
}

function renderSummary(summaryDate, data) {
  const subject = `Tars daily jobs summary for ${summaryDate}`;
  const lines = [
    `Tars daily jobs summary for ${summaryDate}`,
    '',
    'Counts by status:',
    ...Object.entries(data.counts).sort(([left], [right]) => left.localeCompare(right)).map(
      ([status, count]) => `- ${status}: ${count}`,
    ),
    '',
    'Pending approval:',
    ...(data.pending.length
      ? data.pending.map((item) => `- ${item.company} — ${item.title} (${item.location})`)
      : ['- none']),
    '',
    'Submitted today:',
    ...(data.submitted.length
      ? data.submitted.map((item) => `- ${item.company} — ${item.title} (${item.location})`)
      : ['- none']),
    '',
    'Failed today:',
    ...(data.failed.length
      ? data.failed.map((item) => `- ${item.company} — ${item.title}: ${item.last_error || 'unknown error'}`)
      : ['- none']),
    '',
    `Dashboard: http://${config.dashboardHost}:${config.dashboardPort}/`,
  ];

  const textBody = `${lines.join('\n')}\n`;
  const htmlBody = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.4;">
    <h1>${subject}</h1>
    <h2>Counts by status</h2>
    <ul>
      ${Object.entries(data.counts).sort(([left], [right]) => left.localeCompare(right)).map(
        ([status, count]) => `<li><strong>${status}</strong>: ${count}</li>`,
      ).join('')}
    </ul>
    <h2>Pending approval</h2>
    <ul>
      ${(data.pending.length ? data.pending : [{ company: 'none', title: '', location: '' }]).map(
        (item) => `<li>${item.company}${item.title ? ` — ${item.title}` : ''}${item.location ? ` (${item.location})` : ''}</li>`,
      ).join('')}
    </ul>
    <h2>Submitted today</h2>
    <ul>
      ${(data.submitted.length ? data.submitted : [{ company: 'none', title: '', location: '' }]).map(
        (item) => `<li>${item.company}${item.title ? ` — ${item.title}` : ''}${item.location ? ` (${item.location})` : ''}</li>`,
      ).join('')}
    </ul>
    <h2>Failed today</h2>
    <ul>
      ${(data.failed.length ? data.failed : [{ company: 'none', title: '', last_error: '' }]).map(
        (item) => `<li>${item.company}${item.title ? ` — ${item.title}` : ''}${item.last_error ? `: ${item.last_error}` : ''}</li>`,
      ).join('')}
    </ul>
    <p>Dashboard: <a href="http://${config.dashboardHost}:${config.dashboardPort}/">open local dashboard</a></p>
  </body>
</html>`;

  return { subject, textBody, htmlBody };
}

async function maybeSendEmail(rendered) {
  const hasTransport =
    config.smtpHost &&
    config.smtpUser &&
    config.smtpPass &&
    config.summaryEmailTo &&
    config.summaryEmailFrom;

  if (!hasTransport) {
    return {
      status: 'draft',
      deliveryMetadata: {
        sent: false,
        reason: 'SMTP credentials not configured',
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  const info = await transporter.sendMail({
    from: config.summaryEmailFrom,
    to: config.summaryEmailTo,
    subject: rendered.subject,
    text: rendered.textBody,
    html: rendered.htmlBody,
  });

  return {
    status: 'sent',
    deliveryMetadata: {
      sent: true,
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    },
  };
}

async function main() {
  await applyMigrations();
  const workerRun = await withTransaction((client) => createWorkerRun(client, {
    kind: 'send_daily_summary',
    timeoutMinutes: 10,
    details: {},
  }));

  try {
    const summaryDate = new Date().toISOString().slice(0, 10);
    const data = await collectSummaryRows();
    const rendered = renderSummary(summaryDate, data);
    const reportDir = ensureDir(config.reportRoot);
    const reportPath = path.join(reportDir, `${stampForFile()}-daily-summary.txt`);
    fs.writeFileSync(reportPath, rendered.textBody, 'utf8');

    const emailResult = await maybeSendEmail(rendered);
    const summaryRow = await withTransaction((client) => upsertDailySummary(client, {
      summaryDate,
      status: emailResult.status,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
      sentAt: emailResult.status === 'sent' ? new Date().toISOString() : null,
      deliveryMetadata: {
        ...emailResult.deliveryMetadata,
        reportPath,
      },
    }));

    await withTransaction(async (client) => {
      await finishWorkerRun(client, workerRun.id, {
        status: WORKER_RUN_STATUS.SUCCEEDED,
        details: {
          summaryId: summaryRow.id,
          summaryDate,
          reportPath,
          emailStatus: emailResult.status,
        },
      });
    });

    console.log(JSON.stringify({
      ok: true,
      action: 'send_daily_summary',
      summaryDate,
      status: emailResult.status,
      reportPath,
    }, null, 2));
  } catch (error) {
    await withTransaction(async (client) => {
      await finishWorkerRun(client, workerRun.id, {
        status: WORKER_RUN_STATUS.FAILED,
        errorClass: 'send_daily_summary',
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
    action: 'send_daily_summary',
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
