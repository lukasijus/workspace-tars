#!/usr/bin/env node

const http = require('http');
const { URL, URLSearchParams } = require('url');
const { applyMigrations, closePool, query, withTransaction } = require('./lib/db');
const { config } = require('./lib/config');
const { APPROVAL_STATE, APPLICATION_STATUS, FLOW_TYPE } = require('./lib/state');
const {
  createArtifact,
  fetchApplicationDetail,
  fetchDashboardStats,
  findApplicationsForApproval,
  insertApplicationStep,
  setApprovalState,
  updateApplicationStatus,
} = require('./lib/repository');
const { discoverApplicationFlow } = require('./lib/application-discovery');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchApplicationsByStatus(status, limit = 20) {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    WHERE applications.status = $1
    ORDER BY applications.updated_at DESC
    LIMIT $2`,
    [status, limit],
  );
  return result.rows;
}

async function fetchRecentApplications(limit = 25) {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    ORDER BY applications.updated_at DESC
    LIMIT $1`,
    [limit],
  );
  return result.rows;
}

function renderApplicationTable(title, rows, extraColumn) {
  const body = rows.length
    ? rows.map((row) => `<tr>
        <td><a href="/applications/${row.id}">${row.company || ''} — ${row.title || ''}</a></td>
        <td>${escapeHtml(row.location || '')}</td>
        <td>${escapeHtml(row.status || '')}</td>
        <td>${extraColumn ? extraColumn(row) : ''}</td>
      </tr>`).join('')
    : `<tr><td colspan="4">No items</td></tr>`;

  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Location</th>
          <th>Status</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function renderLink(href, label) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderNeedsHumanInputDetails(row) {
  const parts = [];
  const reason = row.last_error || row.draft_payload?.reason || '';
  if (reason) {
    parts.push(`<div>${escapeHtml(reason)}</div>`);
  }
  if (row.external_apply_url) {
    parts.push(`<div>${renderLink(row.external_apply_url, 'Open application')}</div>`);
  } else if (row.source_url) {
    parts.push(`<div>${renderLink(row.source_url, 'Open job')}</div>`);
  }
  parts.push(`<div><form class="inline" method="post" action="/applications/${row.id}/retry-discovery"><button type="submit">Retry discovery</button></form></div>`);
  parts.push(`<div><a href="/applications/${row.id}">Inspect</a></div>`);
  return parts.join('');
}

function decideDiscoveryOutcome(discovery) {
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

function layout(title, body) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f7f8fa; color: #111827; }
      h1, h2, h3 { margin-top: 0; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      a { color: #1d4ed8; text-decoration: none; }
      pre { background: #111827; color: #f9fafb; padding: 12px; border-radius: 8px; overflow: auto; }
      form.inline { display: inline-block; margin-right: 8px; }
      button { border: 1px solid #d1d5db; background: #fff; padding: 8px 12px; border-radius: 8px; cursor: pointer; }
      button.approve { background: #dcfce7; }
      button.reject { background: #fee2e2; }
      .muted { color: #6b7280; }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function sendHtml(response, html, statusCode = 200) {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function fetchApplicationRow(applicationId) {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    WHERE applications.id = $1`,
    [applicationId],
  );
  return result.rows[0] || null;
}

async function parseFormBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk.toString();
      if (raw.length > 1024 * 64) {
        reject(new Error('Form body too large'));
      }
    });
    request.on('end', () => resolve(new URLSearchParams(raw)));
    request.on('error', reject);
  });
}

async function renderHome() {
  const db = { query };
  const [stats, pending, needsHumanInput, recent] = await Promise.all([
    fetchDashboardStats(db),
    findApplicationsForApproval(db, 25),
    fetchApplicationsByStatus(APPLICATION_STATUS.NEEDS_HUMAN_INPUT, 20),
    fetchRecentApplications(20),
  ]);
  const statsCards = Object.entries({
    pending_approval: stats.applicationCounts.pending_approval || 0,
    needs_human_input: stats.applicationCounts.needs_human_input || 0,
    submitted_today: stats.submittedToday,
    failed_today: stats.failedToday,
  }).map(([label, value]) => `<div class="card"><div class="muted">${escapeHtml(label)}</div><div style="font-size:28px;font-weight:700;">${value}</div></div>`).join('');

  return layout('Tars Lifecycle Dashboard', `
    <h1>Tars Lifecycle Dashboard</h1>
    <p class="muted">Local operator surface for pending approvals, recent activity, and worker health.</p>
    <div class="grid">${statsCards}</div>
    ${renderApplicationTable('Pending approval', pending, (row) => `
      <form class="inline" method="post" action="/applications/${row.id}/approve">
        <button class="approve" type="submit">Approve</button>
      </form>
      <form class="inline" method="post" action="/applications/${row.id}/reject">
        <button class="reject" type="submit">Reject</button>
      </form>
    `)}
    ${renderApplicationTable('Needs human input', needsHumanInput, (row) => renderNeedsHumanInputDetails(row))}
    ${renderApplicationTable('Recent applications', recent, (row) => escapeHtml(row.flow_type || ''))}
  `);
}

async function handleApprovalAction(applicationId, action, request, response) {
  const form = await parseFormBody(request).catch(() => new URLSearchParams());
  const reason = form.get('reason') || (action === 'approve'
    ? 'Approved from local dashboard'
    : 'Rejected from local dashboard');
  const current = await fetchApplicationRow(applicationId);

  if (!current) {
    sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
    return;
  }

  if (action === 'approve' && current.status !== APPLICATION_STATUS.PENDING_APPROVAL) {
    sendHtml(response, layout('Approval blocked', `
      <p><a href="/applications/${applicationId}">← application</a></p>
      <h1>Approval blocked</h1>
      <p>This application is currently <strong>${escapeHtml(current.status)}</strong>, not <strong>${APPLICATION_STATUS.PENDING_APPROVAL}</strong>.</p>
      <p>Approval is only valid for rows that are already ready for submission. This row still needs manual review or more automation.</p>
    `), 409);
    return;
  }

  await withTransaction(async (client) => {
    const application = await setApprovalState(client, applicationId, {
      state: action === 'approve' ? APPROVAL_STATE.APPROVED : APPROVAL_STATE.REJECTED,
      actor: 'dashboard',
      reason,
    });
    await insertApplicationStep(
      client,
      application.id,
      null,
      'approval',
      application.status,
      {
        actor: 'dashboard',
        reason,
      },
    );
  });

  response.writeHead(303, { Location: `/applications/${applicationId}` });
  response.end();
}

async function handleRetryDiscovery(applicationId, response) {
  const current = await fetchApplicationRow(applicationId);
  if (!current) {
    sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
    return;
  }

  const discovery = await discoverApplicationFlow({
    jobId: current.source_job_id,
    title: current.title,
    link: current.source_url,
  }, { headed: false });
  const outcome = decideDiscoveryOutcome(discovery);

  await withTransaction(async (client) => {
    const updated = await updateApplicationStatus(client, applicationId, {
      status: outcome.status,
      approvalState: outcome.approvalState,
      flowType: discovery.flowType,
      externalApplyUrl: discovery.externalUrl || null,
      draftPayload: {
        loginState: discovery.loginState || null,
        buttons: discovery.buttons || [],
        reason: discovery.reason || null,
      },
      discoveredFields: discovery.fields || [],
      lastError: outcome.status === APPLICATION_STATUS.FAILED ? discovery.reason : null,
      workerRunId: null,
    });

    await insertApplicationStep(
      client,
      applicationId,
      null,
      'discovery',
      outcome.status,
      {
        actor: 'dashboard_retry',
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
          actor: 'dashboard_retry',
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
          actor: 'dashboard_retry',
        },
      });
    }

    if (outcome.approvalState === APPROVAL_STATE.PENDING) {
      await setApprovalState(client, updated.id, {
        state: APPROVAL_STATE.PENDING,
        actor: 'dashboard_retry',
        reason: 'Discovery retry found a submission-ready flow',
      });
      await insertApplicationStep(
        client,
        updated.id,
        null,
        'approval',
        APPLICATION_STATUS.PENDING_APPROVAL,
        {
          actor: 'dashboard_retry',
          reason: 'Discovery retry found a submission-ready flow',
        },
      );
    }
  });

  response.writeHead(303, { Location: `/applications/${applicationId}` });
  response.end();
}

async function requestHandler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/applications\/(\d+)(?:\/(approve|reject|retry-discovery))?$/);

  if (request.method === 'GET' && url.pathname === '/api/stats') {
    const stats = await fetchDashboardStats({ query });
    sendJson(response, stats);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/applications') {
    const status = url.searchParams.get('status');
    const rows = status
      ? await fetchApplicationsByStatus(status, 100)
      : await fetchRecentApplications(100);
    sendJson(response, { ok: true, rows });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/') {
    sendHtml(response, await renderHome());
    return;
  }

  if (match && request.method === 'GET') {
    const detail = await withTransaction((client) => fetchApplicationDetail(client, Number(match[1])));
    if (!detail) {
      sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
      return;
    }
    const actionButtons = detail.application.status === APPLICATION_STATUS.PENDING_APPROVAL
      ? `
      <form class="inline" method="post" action="/applications/${detail.application.id}/approve">
        <button class="approve" type="submit">Approve</button>
      </form>
      <form class="inline" method="post" action="/applications/${detail.application.id}/reject">
        <button class="reject" type="submit">Reject</button>
      </form>`
      : '';
    const retryButton = `
      <form class="inline" method="post" action="/applications/${detail.application.id}/retry-discovery">
        <button type="submit">Retry discovery</button>
      </form>`;
    sendHtml(response, layout(`Application ${match[1]}`, `
      <p><a href="/">← dashboard</a></p>
      <h1>${escapeHtml(detail.application.company || '')} — ${escapeHtml(detail.application.title || '')}</h1>
      <p><strong>Status:</strong> ${escapeHtml(detail.application.status)}</p>
      <p><strong>Approval:</strong> ${escapeHtml(detail.application.approval_state)}</p>
      <p><strong>Submitted at:</strong> ${escapeHtml(detail.application.submitted_at || 'n/a')}</p>
      <p><strong>Submission attempted at:</strong> ${escapeHtml(detail.application.submission_attempted_at || 'n/a')}</p>
      <p><strong>Flow:</strong> ${escapeHtml(detail.application.flow_type)}</p>
      <p><strong>Location:</strong> ${escapeHtml(detail.application.location || '')}</p>
      <p><strong>Source:</strong> ${detail.application.source_url ? `<a href="${escapeHtml(detail.application.source_url)}">${escapeHtml(detail.application.source_url)}</a>` : 'n/a'}</p>
      <p><strong>External apply URL:</strong> ${detail.application.external_apply_url ? `<a href="${escapeHtml(detail.application.external_apply_url)}">${escapeHtml(detail.application.external_apply_url)}</a>` : 'n/a'}</p>
      <p><strong>CV:</strong> ${escapeHtml(detail.application.cv_variant_file_name || 'n/a')}</p>
      <p><strong>Reason:</strong> ${escapeHtml(detail.application.last_error || detail.application.draft_payload?.reason || 'n/a')}</p>
      ${actionButtons}
      ${retryButton}
      <h2>Artifacts</h2>
      <ul>
        ${detail.artifacts.map((artifact) => `<li>${escapeHtml(artifact.kind)} — ${escapeHtml(artifact.file_path)}</li>`).join('') || '<li>None</li>'}
      </ul>
      <h2>Steps</h2>
      <pre>${escapeHtml(JSON.stringify(detail.steps, null, 2))}</pre>
      <h2>Draft payload</h2>
      <pre>${escapeHtml(JSON.stringify(detail.application.draft_payload, null, 2))}</pre>
      <h2>Discovered fields</h2>
      <pre>${escapeHtml(JSON.stringify(detail.application.discovered_fields, null, 2))}</pre>
    `));
    return;
  }

  if (match && request.method === 'POST' && match[2]) {
    if (match[2] === 'retry-discovery') {
      await handleRetryDiscovery(Number(match[1]), response);
      return;
    }
    await handleApprovalAction(Number(match[1]), match[2], request, response);
    return;
  }

  sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
}

async function main() {
  await applyMigrations();
  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      sendJson(response, { ok: false, error: error.message }, 500);
    });
  });

  server.listen(config.dashboardPort, config.dashboardHost, () => {
    console.log(JSON.stringify({
      ok: true,
      action: 'dashboard',
      host: config.dashboardHost,
      port: config.dashboardPort,
      url: `http://${config.dashboardHost}:${config.dashboardPort}/`,
    }, null, 2));
  });

  const shutdown = async () => {
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    ok: false,
    action: 'dashboard',
    error: error.message,
  }, null, 2));
  await closePool().catch(() => {});
  process.exit(1);
});
