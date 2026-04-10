#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
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
  updateJobAvailability,
  updateApplicationStatus,
} = require('./lib/repository');
const { discoverApplicationFlow } = require('./lib/application-discovery');
const { runSubmitApproved } = require('./submit_approved');

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
      jobs.source_url,
      jobs.is_active,
      jobs.inactive_reason,
      latest_step.details ->> 'reason' AS latest_step_reason,
      latest_image.id AS latest_image_artifact_id,
      latest_image.file_path AS latest_image_path,
      latest_html.id AS latest_html_artifact_id,
      latest_html.file_path AS latest_html_path
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    LEFT JOIN LATERAL (
      SELECT details
      FROM application_steps
      WHERE application_id = applications.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_step ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, file_path
      FROM artifacts
      WHERE entity_type = 'application'
        AND entity_id = applications.id
        AND kind IN ('submission_screenshot', 'discovery_screenshot')
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_image ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, file_path
      FROM artifacts
      WHERE entity_type = 'application'
        AND entity_id = applications.id
        AND kind IN ('submission_html', 'discovery_html')
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_html ON TRUE
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
      jobs.location,
      jobs.source_url,
      jobs.is_active,
      jobs.inactive_reason,
      latest_step.details ->> 'reason' AS latest_step_reason,
      latest_image.id AS latest_image_artifact_id,
      latest_image.file_path AS latest_image_path,
      latest_html.id AS latest_html_artifact_id,
      latest_html.file_path AS latest_html_path
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    LEFT JOIN LATERAL (
      SELECT details
      FROM application_steps
      WHERE application_id = applications.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_step ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, file_path
      FROM artifacts
      WHERE entity_type = 'application'
        AND entity_id = applications.id
        AND kind IN ('submission_screenshot', 'discovery_screenshot')
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_image ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, file_path
      FROM artifacts
      WHERE entity_type = 'application'
        AND entity_id = applications.id
        AND kind IN ('submission_html', 'discovery_html')
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_html ON TRUE
    ORDER BY applications.updated_at DESC
    LIMIT $1`,
    [limit],
  );
  return result.rows;
}

function summarizeRowReason(row) {
  if (row.is_active === false && row.inactive_reason) {
    return row.inactive_reason;
  }
  return (
    row.last_error ||
    row.draft_payload?.reason ||
    row.draft_payload?.externalStep?.stepTitle ||
    row.latest_step_reason ||
    ""
  );
}

function truncateText(value, max = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function slugFromPath(filePath) {
  if (!filePath) return '';
  return path.basename(filePath);
}

function renderSnapshotThumb(row) {
  if (!row.latest_image_artifact_id) return '';
  return `<div class="thumb-link" title="${escapeHtml(slugFromPath(row.latest_image_path))}">
    <img class="thumb" src="/artifacts/${row.latest_image_artifact_id}" alt="Latest workflow snapshot for application ${row.id}" />
  </div>`;
}

function renderApplicationTable(title, rows, extraColumn) {
  const body = rows.length
    ? rows.map((row) => `<tr class="clickable-row" data-href="/applications/${row.id}" tabindex="0" role="link" aria-label="Open ${escapeHtml(`${row.company || ''} ${row.title || ''}`)}">
        <td>${escapeHtml(`${row.company || ''} — ${row.title || ''}`)}</td>
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
  if (row.flow_type) {
    parts.push(`<div class="flow-chip">${escapeHtml(row.flow_type)}</div>`);
  }
  const externalStep = row.draft_payload?.externalStep || null;
  const unresolvedCount = Array.isArray(row.draft_payload?.unresolvedFields)
    ? row.draft_payload.unresolvedFields.length
    : 0;
  if (externalStep?.providerHint || unresolvedCount) {
    parts.push(
      `<div class="detail-meta">${
        externalStep?.providerHint
          ? `Provider: ${escapeHtml(externalStep.providerHint)}`
          : ''
      }${
        externalStep?.providerHint && unresolvedCount ? ' · ' : ''
      }${
        unresolvedCount ? `${unresolvedCount} unresolved field(s)` : ''
      }</div>`,
    );
  }
  const reason = summarizeRowReason(row);
  if (reason) {
    parts.push(`<div class="detail-summary">${escapeHtml(truncateText(reason, 120))}</div>`);
  }
  if (row.is_active === false) {
    parts.push(`<div class="detail-meta"><strong>Inactive</strong>: ${escapeHtml(row.inactive_reason || 'Employer is no longer accepting applications')}</div>`);
  }
  parts.push(renderSnapshotThumb(row));
  return parts.join('');
}

function renderPendingApprovalDetails(row) {
  const parts = [];
  if (row.flow_type) {
    parts.push(`<div class="flow-chip">${escapeHtml(row.flow_type)}</div>`);
  }
  parts.push(`<div class="detail-summary">Ready for approval</div>`);
  const reason = summarizeRowReason(row);
  if (reason) {
    parts.push(`<div class="detail-meta">${escapeHtml(truncateText(reason, 120))}</div>`);
  }
  parts.push(renderSnapshotThumb(row));
  return parts.join('');
}

function renderRecentApplicationDetails(row) {
  const parts = [];
  if (row.flow_type) {
    parts.push(`<div class="flow-chip">${escapeHtml(row.flow_type)}</div>`);
  }
  const reason = summarizeRowReason(row);
  if (reason) {
    parts.push(`<div class="detail-summary muted">${escapeHtml(truncateText(reason, 120))}</div>`);
  }
  if (row.is_active === false) {
    parts.push(`<div class="detail-meta"><strong>Inactive</strong>: ${escapeHtml(row.inactive_reason || 'Employer closed the role')}</div>`);
  }
  if (row.status === APPLICATION_STATUS.SUBMITTED && row.submitted_at) {
    parts.push(`<div class="detail-meta">Submitted: ${escapeHtml(row.submitted_at)}</div>`);
  }
  parts.push(renderSnapshotThumb(row));
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

  if (discovery.readiness === 'ready_for_approval') {
    if (
      discovery.flowType === FLOW_TYPE.EXTERNAL_CUSTOM &&
      config.applicantPolicy?.approval?.externalAutoApprove
    ) {
      return {
        status: APPLICATION_STATUS.APPROVED,
        approvalState: APPROVAL_STATE.APPROVED,
      };
    }

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
      :root {
        --bg: #f3f5f8;
        --panel: #ffffff;
        --line: #e3e8ef;
        --text: #18212f;
        --muted: #667085;
        --accent: #1d4ed8;
        --chip: #eef2ff;
        --success: #e8f7eb;
        --warn: #fff4db;
        --danger: #fee8e8;
      }
      body { font-family: "Inter", "Segoe UI", sans-serif; margin: 0; padding: 24px; background: radial-gradient(circle at top left, #fdfefe, var(--bg) 40%); color: var(--text); }
      h1, h2, h3 { margin-top: 0; letter-spacing: -0.02em; }
      section { margin-bottom: 20px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
      .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); }
      table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); }
      th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
      th { background: #f8fafc; color: #475467; font-weight: 600; }
      tr:last-child td { border-bottom: none; }
      td:last-child { min-width: 260px; }
      .clickable-row { transition: background 120ms ease, transform 120ms ease; }
      .clickable-row:hover { background: #eef4ff; cursor: pointer; }
      .clickable-row:focus-visible { outline: 2px solid #93c5fd; outline-offset: -2px; background: #eff6ff; }
      a { color: var(--accent); text-decoration: none; }
      pre { background: #111827; color: #f9fafb; padding: 12px; border-radius: 8px; overflow: auto; }
      form.inline { display: inline-block; margin-right: 8px; }
      button { border: 1px solid #d1d5db; background: #fff; padding: 6px 10px; border-radius: 999px; cursor: pointer; font-size: 12px; }
      button.approve { background: var(--success); }
      button.reject { background: var(--danger); }
      .muted { color: var(--muted); }
      .detail-summary { font-weight: 500; margin-bottom: 6px; }
      .detail-meta { color: var(--muted); margin-bottom: 6px; }
      .action-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
      .action-pill { display: inline-flex; align-items: center; padding: 5px 9px; border-radius: 999px; background: var(--chip); color: var(--accent); font-size: 12px; }
      .flow-chip { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: 12px; margin-bottom: 6px; }
      .thumb-link { display: inline-block; margin: 4px 0 6px; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); background: #f8fafc; }
      .thumb { display: block; width: 112px; height: 72px; object-fit: cover; }
      .hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
      .hero p { margin: 0; max-width: 720px; }
      .hero-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      button[disabled] { opacity: 0.45; cursor: not-allowed; }
      .page-status {
        position: sticky;
        top: 12px;
        z-index: 30;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
        padding: 10px 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        color: var(--text);
      }
      .page-status.is-error { border-color: #f5c2c7; background: #fff5f5; color: #991b1b; }
      .page-status[hidden] { display: none; }
      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(29, 78, 216, 0.2);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      button.is-loading {
        opacity: 0.75;
        cursor: progress;
      }
      button.is-loading .spinner {
        margin-right: 6px;
        width: 12px;
        height: 12px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div id="page-status" class="page-status" hidden>
      <span class="spinner" aria-hidden="true"></span>
      <span id="page-status-text">Working…</span>
    </div>
    ${body}
    <script>
      const pageStatus = document.getElementById('page-status');
      const pageStatusText = document.getElementById('page-status-text');

      function setPageStatus(message, isError = false) {
        if (!pageStatus || !pageStatusText) return;
        pageStatus.hidden = false;
        pageStatus.classList.toggle('is-error', Boolean(isError));
        pageStatusText.textContent = message;
      }

      function clearPageStatus() {
        if (!pageStatus) return;
        pageStatus.hidden = true;
        pageStatus.classList.remove('is-error');
      }

      async function submitActionForm(form, submitter) {
        const originalContent = submitter ? submitter.innerHTML : '';
        const pendingLabel = form.dataset.pendingLabel || submitter?.dataset.pendingLabel || submitter?.textContent?.trim() || 'Working…';

        if (submitter) {
          submitter.disabled = true;
          submitter.classList.add('is-loading');
          submitter.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + pendingLabel + '</span>';
        }
        Array.from(form.elements || []).forEach((element) => {
          if (element !== submitter) element.disabled = true;
        });
        setPageStatus(pendingLabel);

        try {
          const formData = new FormData(form);
          const payload = new URLSearchParams();
          formData.forEach((value, key) => {
            if (typeof value === 'string') payload.append(key, value);
          });
          const response = await fetch(form.action, {
            method: (form.method || 'POST').toUpperCase(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'fetch',
            },
            body: payload.toString(),
            redirect: 'follow',
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || 'Action failed');
          }

          setPageStatus('Done. Refreshing…');
          if (response.redirected && response.url && response.url !== window.location.href) {
            window.location.assign(response.url);
            return;
          }
          window.location.reload();
        } catch (error) {
          setPageStatus('Action failed. Check details and try again.', true);
          if (submitter) {
            submitter.disabled = false;
            submitter.classList.remove('is-loading');
            submitter.innerHTML = originalContent;
          }
          Array.from(form.elements || []).forEach((element) => {
            element.disabled = false;
          });
          console.error(error);
        }
      }

      document.addEventListener('click', (event) => {
        const row = event.target.closest('.clickable-row');
        if (!row) return;
        if (event.target.closest('a, button, input, textarea, select, form')) return;
        const href = row.getAttribute('data-href');
        if (href) window.location.href = href;
      });
      document.addEventListener('keydown', (event) => {
        const row = event.target.closest('.clickable-row');
        if (!row) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const href = row.getAttribute('data-href');
        if (href) window.location.href = href;
      });

      document.addEventListener('submit', (event) => {
        const form = event.target.closest('form.js-async-form');
        if (!form) return;
        event.preventDefault();
        if (form.dataset.submitting === 'true') return;
        form.dataset.submitting = 'true';
        submitActionForm(form, event.submitter || form.querySelector('button[type="submit"]'))
          .finally(() => {
            delete form.dataset.submitting;
          });
      });
    </script>
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
      jobs.source_url,
      jobs.is_active,
      jobs.inactive_reason
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    WHERE applications.id = $1`,
    [applicationId],
  );
  return result.rows[0] || null;
}

async function fetchArtifactRow(artifactId) {
  const result = await query(
    `SELECT *
    FROM artifacts
    WHERE id = $1`,
    [artifactId],
  );
  return result.rows[0] || null;
}

function inferMimeType(filePath, fallback = 'application/octet-stream') {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return fallback;
}

function sendFile(response, artifact) {
  const filePath = artifact.file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    sendHtml(response, layout('Artifact missing', '<h1>Artifact missing</h1>'), 404);
    return;
  }

  response.writeHead(200, {
    'Content-Type': artifact.mime_type || inferMimeType(filePath),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(response);
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
  const approvedCount = stats.applicationCounts.approved || 0;
  const statsCards = Object.entries({
    pending_approval: stats.applicationCounts.pending_approval || 0,
    needs_human_input: stats.applicationCounts.needs_human_input || 0,
    submitted_today: stats.submittedToday,
    failed_today: stats.failedToday,
  }).map(([label, value]) => `<div class="card"><div class="muted">${escapeHtml(label)}</div><div style="font-size:28px;font-weight:700;">${value}</div></div>`).join('');

  return layout('Tars Lifecycle Dashboard', `
    <div class="hero">
      <div>
        <h1>Tars Lifecycle Dashboard</h1>
        <p class="muted">Local operator surface for approvals, latest workflow snapshots, and application health.</p>
      </div>
      <div class="hero-actions">
        <form class="inline js-async-form" method="post" action="/submit-approved" data-pending-label="Submitting approved applications…">
          <button class="approve" type="submit"${approvedCount ? '' : ' disabled'}>Submit approved${approvedCount ? ` (${approvedCount})` : ''}</button>
        </form>
      </div>
    </div>
    <div class="grid">${statsCards}</div>
    ${renderApplicationTable('Pending approval', pending, (row) => renderPendingApprovalDetails(row))}
    ${renderApplicationTable('Needs human input', needsHumanInput, (row) => renderNeedsHumanInputDetails(row))}
    ${renderApplicationTable('Recent applications', recent, (row) => renderRecentApplicationDetails(row))}
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

  if (current.is_active === false) {
    sendHtml(response, layout('Retry blocked', `
      <p><a href="/applications/${applicationId}">← application</a></p>
      <h1>Retry blocked</h1>
      <p>This job is currently marked <strong>inactive</strong>.</p>
      <p>${escapeHtml(current.inactive_reason || 'Employer is no longer accepting applications.')}</p>
    `), 409);
    return;
  }

  const discovery = await discoverApplicationFlow({
    jobId: current.source_job_id,
    title: current.title,
    link: current.source_url,
  }, {
    headed: false,
    application: current,
  });
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
        externalStep: discovery.discoveredFields || null,
        unresolvedFields: discovery.unresolvedFields || [],
      },
      discoveredFields: discovery.discoveredFields || discovery.fields || [],
      lastError: outcome.status === APPLICATION_STATUS.FAILED ? discovery.reason : null,
      workerRunId: null,
    });

    await client.query(
      `UPDATE jobs
      SET is_active = $2,
          inactive_reason = CASE WHEN $2 THEN NULL ELSE $3 END,
          inactive_detected_at = CASE
            WHEN $2 THEN NULL
            ELSE COALESCE(inactive_detected_at, NOW())
          END
      WHERE id = $1`,
      [current.job_id, discovery.jobActive !== false, discovery.inactiveReason || discovery.reason || null],
    );

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
        unresolvedFields: discovery.unresolvedFields || [],
        externalStep: discovery.discoveredFields || null,
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

    if (outcome.approvalState === APPROVAL_STATE.APPROVED) {
      await setApprovalState(client, updated.id, {
        state: APPROVAL_STATE.APPROVED,
        actor: 'dashboard_retry',
        reason: 'Discovery retry auto-approved by applicant policy',
      });
      await insertApplicationStep(
        client,
        updated.id,
        null,
        'approval',
        APPLICATION_STATUS.APPROVED,
        {
          actor: 'dashboard_retry',
          reason: 'Discovery retry auto-approved by applicant policy',
        },
      );
    }
  });

  response.writeHead(303, { Location: `/applications/${applicationId}` });
  response.end();
}

async function handleMarkInactive(applicationId, request, response) {
  const form = await parseFormBody(request).catch(() => new URLSearchParams());
  const reason =
    form.get('reason')?.trim() || 'Manually marked inactive from dashboard';
  const current = await fetchApplicationRow(applicationId);

  if (!current) {
    sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
    return;
  }

  await withTransaction(async (client) => {
    await updateJobAvailability(client, current.job_id, {
      isActive: false,
      reason,
    });

    const nextStatus =
      current.status === APPLICATION_STATUS.SUBMITTED
        ? APPLICATION_STATUS.SUBMITTED
        : APPLICATION_STATUS.SKIPPED;
    const nextApprovalState =
      current.status === APPLICATION_STATUS.SUBMITTED
        ? current.approval_state
        : APPROVAL_STATE.NONE;

    await updateApplicationStatus(client, applicationId, {
      status: nextStatus,
      approvalState: nextApprovalState,
      lastError: current.status === APPLICATION_STATUS.SUBMITTED ? current.last_error : reason,
      draftPayload: {
        reason,
        manuallyMarkedInactive: true,
      },
      workerRunId: null,
    });

    await insertApplicationStep(
      client,
      applicationId,
      null,
      'operator',
      nextStatus,
      {
        actor: 'dashboard',
        action: 'mark_inactive',
        reason,
      },
    );
  });

  response.writeHead(303, { Location: `/applications/${applicationId}` });
  response.end();
}

async function handleSubmitApproved(response, applicationId = null) {
  if (applicationId) {
    const current = await fetchApplicationRow(applicationId);
    if (!current) {
      sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
      return;
    }

    if (current.status !== APPLICATION_STATUS.APPROVED) {
      sendHtml(response, layout('Submit blocked', `
        <p><a href="/applications/${applicationId}">← application</a></p>
        <h1>Submit blocked</h1>
        <p>This application is currently <strong>${escapeHtml(current.status)}</strong>, not <strong>${APPLICATION_STATUS.APPROVED}</strong>.</p>
        <p>Approve it first, or fix discovery/manual blockers before submitting.</p>
      `), 409);
      return;
    }
  }

  await runSubmitApproved({
    applicationIds: applicationId ? [applicationId] : [],
    limit: applicationId ? 1 : config.searchBatchSize,
    source: 'dashboard',
  });

  response.writeHead(303, {
    Location: applicationId ? `/applications/${applicationId}` : '/',
  });
  response.end();
}

async function requestHandler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/applications\/(\d+)(?:\/(approve|reject|retry-discovery|mark-inactive|submit))?$/);
  const artifactMatch = url.pathname.match(/^\/artifacts\/(\d+)$/);

  if (artifactMatch && request.method === 'GET') {
    const artifact = await fetchArtifactRow(Number(artifactMatch[1]));
    if (!artifact) {
      sendHtml(response, layout('Artifact not found', '<h1>Artifact not found</h1>'), 404);
      return;
    }
    sendFile(response, artifact);
    return;
  }

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

  if (request.method === 'POST' && url.pathname === '/submit-approved') {
    await handleSubmitApproved(response, null);
    return;
  }

  if (match && request.method === 'GET') {
    const detail = await withTransaction((client) => fetchApplicationDetail(client, Number(match[1])));
    if (!detail) {
      sendHtml(response, layout('Not found', '<h1>Not found</h1>'), 404);
      return;
    }
    const latestImageArtifact = detail.artifacts.find((artifact) =>
      ['submission_screenshot', 'discovery_screenshot'].includes(artifact.kind),
    );
    const latestHtmlArtifact = detail.artifacts.find((artifact) =>
      ['submission_html', 'discovery_html'].includes(artifact.kind),
    );
    const actionButtons = detail.application.status === APPLICATION_STATUS.PENDING_APPROVAL
      ? `
      <form class="inline js-async-form" method="post" action="/applications/${detail.application.id}/approve" data-pending-label="Approving…">
        <button class="approve" type="submit">Approve</button>
      </form>
      <form class="inline js-async-form" method="post" action="/applications/${detail.application.id}/reject" data-pending-label="Rejecting…">
        <button class="reject" type="submit">Reject</button>
      </form>`
      : '';
    const submitButton =
      detail.application.status === APPLICATION_STATUS.APPROVED &&
      detail.application.is_active !== false
        ? `
      <form class="inline js-async-form" method="post" action="/applications/${detail.application.id}/submit" data-pending-label="Submitting application…">
        <button class="approve" type="submit">Submit now</button>
      </form>`
        : '';
    const retryButton = detail.application.is_active === false
      ? ''
      : `
      <form class="inline js-async-form" method="post" action="/applications/${detail.application.id}/retry-discovery" data-pending-label="Retrying discovery…">
        <button type="submit">Retry discovery</button>
      </form>`;
    const inactiveButton = detail.application.is_active === false
      ? ''
      : `
      <form class="inline js-async-form" method="post" action="/applications/${detail.application.id}/mark-inactive" data-pending-label="Marking inactive…">
        <input type="text" name="reason" placeholder="Reason for inactive flag" aria-label="Reason for inactive flag" />
        <button class="reject" type="submit">Mark inactive</button>
      </form>`;
    const externalStep = detail.application.draft_payload?.externalStep || null;
    const unresolvedFields = detail.application.draft_payload?.unresolvedFields || [];
    sendHtml(response, layout(`Application ${match[1]}`, `
      <p><a href="/">← dashboard</a></p>
      <h1>${escapeHtml(detail.application.company || '')} — ${escapeHtml(detail.application.title || '')}</h1>
      <p><strong>Status:</strong> ${escapeHtml(detail.application.status)}</p>
      <p><strong>Approval:</strong> ${escapeHtml(detail.application.approval_state)}</p>
      <p><strong>Submitted at:</strong> ${escapeHtml(detail.application.submitted_at || 'n/a')}</p>
      <p><strong>Submission attempted at:</strong> ${escapeHtml(detail.application.submission_attempted_at || 'n/a')}</p>
      <p><strong>Flow:</strong> ${escapeHtml(detail.application.flow_type)}</p>
      <p><strong>Job active:</strong> ${detail.application.is_active === false ? 'no' : 'yes'}</p>
      <p><strong>Inactive reason:</strong> ${escapeHtml(detail.application.inactive_reason || 'n/a')}</p>
      <p><strong>Location:</strong> ${escapeHtml(detail.application.location || '')}</p>
      <p><strong>Source:</strong> ${detail.application.source_url ? `<a href="${escapeHtml(detail.application.source_url)}">${escapeHtml(detail.application.source_url)}</a>` : 'n/a'}</p>
      <p><strong>External apply URL:</strong> ${detail.application.external_apply_url ? `<a href="${escapeHtml(detail.application.external_apply_url)}">${escapeHtml(detail.application.external_apply_url)}</a>` : 'n/a'}</p>
      <p><strong>CV:</strong> ${escapeHtml(detail.application.cv_variant_file_name || 'n/a')}</p>
      <p><strong>Reason:</strong> ${escapeHtml(detail.application.inactive_reason || detail.application.last_error || detail.application.draft_payload?.reason || 'n/a')}</p>
      ${actionButtons}
      ${submitButton}
      ${retryButton}
      ${inactiveButton}
      ${externalStep ? `
        <h2>Latest external step</h2>
        <pre>${escapeHtml(JSON.stringify({
          providerHint: externalStep.providerHint,
          stepTitle: externalStep.stepTitle,
          url: externalStep.url,
          unresolvedFields: unresolvedFields.map((field) => ({
            label: field.label,
            type: field.type,
            questionIntent: field.questionIntent || null,
            resolvedAnswer: field.resolvedAnswer || null,
            resolutionSource: field.resolutionSource || null,
            resolutionConfidence: field.resolutionConfidence || 0,
          })),
          validationErrors: externalStep.validationErrors || [],
          buttons: externalStep.buttons || [],
        }, null, 2))}</pre>
      ` : ''}
      ${latestImageArtifact ? `<h2>Latest snapshot</h2><a class="thumb-link" href="/artifacts/${latestImageArtifact.id}" target="_blank" rel="noreferrer"><img class="thumb" src="/artifacts/${latestImageArtifact.id}" alt="Latest snapshot" style="width:320px;height:200px;" /></a>` : ''}
      ${latestHtmlArtifact ? `<p><a class="action-pill" href="/artifacts/${latestHtmlArtifact.id}" target="_blank" rel="noreferrer">Open latest HTML</a></p>` : ''}
      <h2>Artifacts</h2>
      <ul>
        ${detail.artifacts.map((artifact) => `<li><a href="/artifacts/${artifact.id}" target="_blank" rel="noreferrer">${escapeHtml(artifact.kind)}</a> <span class="muted">(${escapeHtml(path.basename(artifact.file_path || ''))})</span></li>`).join('') || '<li>None</li>'}
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
    if (match[2] === 'submit') {
      await handleSubmitApproved(response, Number(match[1]));
      return;
    }
    if (match[2] === 'mark-inactive') {
      await handleMarkInactive(Number(match[1]), request, response);
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
