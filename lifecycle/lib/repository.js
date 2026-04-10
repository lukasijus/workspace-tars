const { APPLICATION_STATUS, APPROVAL_STATE, WORKER_RUN_STATUS } = require('./state');

async function createWorkerRun(client, params) {
  const result = await client.query(
    `INSERT INTO worker_runs (
      kind,
      status,
      timeout_at,
      details
    ) VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, $4::jsonb)
    RETURNING *`,
    [
      params.kind,
      params.status || WORKER_RUN_STATUS.RUNNING,
      String(params.timeoutMinutes || 20),
      JSON.stringify(params.details || {}),
    ],
  );
  return result.rows[0];
}

async function heartbeatWorkerRun(client, runId, detailsPatch = null) {
  if (detailsPatch) {
    await client.query(
      `UPDATE worker_runs
      SET heartbeat_at = NOW(),
          details = COALESCE(details, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
      [runId, JSON.stringify(detailsPatch)],
    );
    return;
  }
  await client.query(
    `UPDATE worker_runs
    SET heartbeat_at = NOW()
    WHERE id = $1`,
    [runId],
  );
}

async function finishWorkerRun(client, runId, params) {
  const result = await client.query(
    `UPDATE worker_runs
    SET status = $2,
        finished_at = NOW(),
        heartbeat_at = NOW(),
        error_class = $3,
        error_message = $4,
        details = COALESCE(details, '{}'::jsonb) || $5::jsonb
    WHERE id = $1
    RETURNING *`,
    [
      runId,
      params.status,
      params.errorClass || null,
      params.errorMessage || null,
      JSON.stringify(params.details || {}),
    ],
  );
  return result.rows[0];
}

async function createArtifact(client, params) {
  const result = await client.query(
    `INSERT INTO artifacts (
      entity_type,
      entity_id,
      kind,
      file_path,
      mime_type,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    RETURNING *`,
    [
      params.entityType,
      params.entityId,
      params.kind,
      params.filePath,
      params.mimeType || null,
      JSON.stringify(params.metadata || {}),
    ],
  );
  return result.rows[0];
}

async function upsertJob(client, job, workerRunId, dedupeKey) {
  const result = await client.query(
    `INSERT INTO jobs (
      dedupe_key,
      source,
      source_job_id,
      source_url,
      company,
      title,
      location,
      posted_time,
      latest_fit_score,
      matched_strong,
      matched_bonus,
      latest_seen_at,
      last_search_name,
      last_run_id,
      metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10::jsonb, $11::jsonb, NOW(), $12, $13, $14::jsonb
    )
    ON CONFLICT (dedupe_key) DO UPDATE
    SET source = EXCLUDED.source,
        source_job_id = EXCLUDED.source_job_id,
        source_url = EXCLUDED.source_url,
        company = EXCLUDED.company,
        title = EXCLUDED.title,
        location = EXCLUDED.location,
        posted_time = EXCLUDED.posted_time,
        latest_fit_score = EXCLUDED.latest_fit_score,
        matched_strong = EXCLUDED.matched_strong,
        matched_bonus = EXCLUDED.matched_bonus,
        latest_seen_at = NOW(),
        last_search_name = EXCLUDED.last_search_name,
        last_run_id = EXCLUDED.last_run_id,
        metadata = COALESCE(jobs.metadata, '{}'::jsonb) || EXCLUDED.metadata
    RETURNING *`,
    [
      dedupeKey,
      job.source || 'linkedin',
      job.jobId || null,
      job.link || null,
      job.company || null,
      job.title || null,
      job.location || null,
      job.postedTime || null,
      job.fitScore || 0,
      JSON.stringify(job.matchedStrong || []),
      JSON.stringify(job.matchedBonus || []),
      job.searchName || null,
      workerRunId,
      JSON.stringify({
        searchUrl: job.searchUrl || null,
      }),
    ],
  );
  return result.rows[0];
}

async function updateJobAvailability(client, jobId, params) {
  const isActive = params.isActive !== false;
  const result = await client.query(
    `UPDATE jobs
    SET is_active = $2,
        inactive_reason = CASE WHEN $2 THEN NULL ELSE $3 END,
        inactive_detected_at = CASE
          WHEN $2 THEN NULL
          ELSE COALESCE(inactive_detected_at, NOW())
        END
    WHERE id = $1
    RETURNING *`,
    [jobId, isActive, params.reason || null],
  );
  return result.rows[0];
}

async function insertJobRun(client, jobId, workerRunId, job, summary = {}) {
  const result = await client.query(
    `INSERT INTO job_runs (
      job_id,
      worker_run_id,
      search_name,
      fit_score,
      raw_payload,
      summary
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    RETURNING *`,
    [
      jobId,
      workerRunId,
      job.searchName || null,
      job.fitScore || 0,
      JSON.stringify(job),
      JSON.stringify(summary),
    ],
  );
  return result.rows[0];
}

async function upsertApplication(client, params) {
  const result = await client.query(
    `INSERT INTO applications (
      job_id,
      status,
      flow_type,
      approval_state,
      cv_variant_path,
      cv_variant_file_name,
      external_apply_url,
      draft_payload,
      discovered_fields,
      last_error,
      retry_count,
      last_worker_run_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8::jsonb, $9::jsonb, $10, $11, $12
    )
    ON CONFLICT (job_id) DO UPDATE
    SET status = EXCLUDED.status,
        flow_type = EXCLUDED.flow_type,
        approval_state = EXCLUDED.approval_state,
        cv_variant_path = COALESCE(EXCLUDED.cv_variant_path, applications.cv_variant_path),
        cv_variant_file_name = COALESCE(EXCLUDED.cv_variant_file_name, applications.cv_variant_file_name),
        external_apply_url = COALESCE(EXCLUDED.external_apply_url, applications.external_apply_url),
        draft_payload = COALESCE(applications.draft_payload, '{}'::jsonb) || EXCLUDED.draft_payload,
        discovered_fields = CASE
          WHEN EXCLUDED.discovered_fields = '[]'::jsonb THEN applications.discovered_fields
          ELSE EXCLUDED.discovered_fields
        END,
        last_error = EXCLUDED.last_error,
        retry_count = EXCLUDED.retry_count,
        last_worker_run_id = EXCLUDED.last_worker_run_id,
        updated_at = NOW()
    RETURNING *`,
    [
      params.jobId,
      params.status,
      params.flowType || 'unknown',
      params.approvalState || APPROVAL_STATE.NONE,
      params.cvVariantPath || null,
      params.cvVariantFileName || null,
      params.externalApplyUrl || null,
      JSON.stringify(params.draftPayload || {}),
      JSON.stringify(params.discoveredFields || []),
      params.lastError || null,
      params.retryCount || 0,
      params.workerRunId || null,
    ],
  );
  return result.rows[0];
}

async function updateApplicationStatus(client, applicationId, params) {
  const result = await client.query(
    `UPDATE applications
    SET status = COALESCE($2, status),
        approval_state = COALESCE($3, approval_state),
        flow_type = COALESCE($4, flow_type),
        external_apply_url = COALESCE($5, external_apply_url),
        draft_payload = COALESCE(draft_payload, '{}'::jsonb) || $6::jsonb,
        discovered_fields = CASE
          WHEN $7::jsonb = '[]'::jsonb THEN discovered_fields
          ELSE $7::jsonb
        END,
        cv_variant_path = COALESCE($8, cv_variant_path),
        cv_variant_file_name = COALESCE($9, cv_variant_file_name),
        retry_count = COALESCE($10, retry_count),
        last_error = $11,
        last_worker_run_id = COALESCE($12, last_worker_run_id),
        submission_attempted_at = CASE WHEN $13 THEN NOW() ELSE submission_attempted_at END,
        submitted_at = CASE WHEN $14 THEN NOW() ELSE submitted_at END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *`,
    [
      applicationId,
      params.status || null,
      params.approvalState || null,
      params.flowType || null,
      params.externalApplyUrl || null,
      JSON.stringify(params.draftPayload || {}),
      JSON.stringify(params.discoveredFields || []),
      params.cvVariantPath || null,
      params.cvVariantFileName || null,
      typeof params.retryCount === 'number' ? params.retryCount : null,
      params.lastError || null,
      params.workerRunId || null,
      Boolean(params.markSubmissionAttempted),
      Boolean(params.markSubmitted),
    ],
  );
  return result.rows[0];
}

async function insertApplicationStep(client, applicationId, workerRunId, step, status, details = {}) {
  const result = await client.query(
    `INSERT INTO application_steps (
      application_id,
      worker_run_id,
      step,
      status,
      details
    ) VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING *`,
    [
      applicationId,
      workerRunId || null,
      step,
      status,
      JSON.stringify(details),
    ],
  );
  return result.rows[0];
}

async function setApprovalState(client, applicationId, params) {
  const state = params.state;
  await client.query(
    `INSERT INTO approvals (
      application_id,
      state,
      actor,
      reason,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (application_id) DO UPDATE
    SET state = EXCLUDED.state,
        actor = EXCLUDED.actor,
        reason = EXCLUDED.reason,
        updated_at = NOW()`,
    [
      applicationId,
      state,
      params.actor || null,
      params.reason || null,
    ],
  );

  let nextStatus = null;
  if (state === APPROVAL_STATE.APPROVED) nextStatus = APPLICATION_STATUS.APPROVED;
  if (state === APPROVAL_STATE.REJECTED) nextStatus = APPLICATION_STATUS.SKIPPED;
  if (state === APPROVAL_STATE.PENDING) nextStatus = APPLICATION_STATUS.PENDING_APPROVAL;

  const result = await client.query(
    `UPDATE applications
    SET approval_state = $2,
        status = COALESCE($3, status),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *`,
    [applicationId, state, nextStatus],
  );
  return result.rows[0];
}

async function findApplicationsForApproval(client, limit = 50) {
  const result = await client.query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url,
      jobs.is_active,
      jobs.inactive_reason,
      approvals.actor AS approval_actor,
      approvals.reason AS approval_reason,
      latest_step.details ->> 'reason' AS latest_step_reason
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    LEFT JOIN approvals ON approvals.application_id = applications.id
    LEFT JOIN LATERAL (
      SELECT details
      FROM application_steps
      WHERE application_id = applications.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_step ON TRUE
    WHERE applications.status = $1
      AND COALESCE(jobs.is_active, true) = true
    ORDER BY jobs.latest_fit_score DESC, jobs.latest_seen_at DESC
    LIMIT $2`,
    [APPLICATION_STATUS.PENDING_APPROVAL, limit],
  );
  return result.rows;
}

async function findApprovedApplications(client, limit = 20) {
  const result = await client.query(
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
    WHERE applications.status = $1
      AND COALESCE(jobs.is_active, true) = true
    ORDER BY applications.updated_at ASC
    LIMIT $2`,
    [APPLICATION_STATUS.APPROVED, limit],
  );
  return result.rows;
}

async function fetchApplicationDetail(client, applicationId) {
  const application = await client.query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url,
      jobs.posted_time,
      jobs.latest_fit_score,
      jobs.matched_strong,
      jobs.matched_bonus,
      jobs.is_active,
      jobs.inactive_reason,
      jobs.inactive_detected_at,
      approvals.actor AS approval_actor,
      approvals.reason AS approval_reason
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    LEFT JOIN approvals ON approvals.application_id = applications.id
    WHERE applications.id = $1`,
    [applicationId],
  );
  if (application.rowCount === 0) return null;

  const [steps, artifacts] = await Promise.all([
    client.query(
      `SELECT * FROM application_steps
      WHERE application_id = $1
      ORDER BY created_at DESC`,
      [applicationId],
    ),
    client.query(
      `SELECT * FROM artifacts
      WHERE entity_type = 'application' AND entity_id = $1
      ORDER BY created_at DESC`,
      [applicationId],
    ),
  ]);

  return {
    application: application.rows[0],
    steps: steps.rows,
    artifacts: artifacts.rows,
  };
}

async function fetchDashboardStats(client) {
  const [applicationCounts, submittedToday, failedToday, recentRuns] = await Promise.all([
    client.query(
      `SELECT status, COUNT(*)::int AS count
      FROM applications
      GROUP BY status`,
    ),
    client.query(
      `SELECT COUNT(*)::int AS count
      FROM applications
      WHERE submitted_at::date = CURRENT_DATE`,
    ),
    client.query(
      `SELECT COUNT(*)::int AS count
      FROM applications
      WHERE status = $1
        AND updated_at::date = CURRENT_DATE`,
      [APPLICATION_STATUS.FAILED],
    ),
    client.query(
      `SELECT * FROM worker_runs
      ORDER BY started_at DESC
      LIMIT 10`,
    ),
  ]);

  return {
    applicationCounts: Object.fromEntries(
      applicationCounts.rows.map((row) => [row.status, row.count]),
    ),
    submittedToday: submittedToday.rows[0]?.count || 0,
    failedToday: failedToday.rows[0]?.count || 0,
    recentRuns: recentRuns.rows,
  };
}

async function upsertDailySummary(client, params) {
  const result = await client.query(
    `INSERT INTO daily_summaries (
      summary_date,
      status,
      subject,
      text_body,
      html_body,
      sent_at,
      delivery_metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (summary_date) DO UPDATE
    SET status = EXCLUDED.status,
        subject = EXCLUDED.subject,
        text_body = EXCLUDED.text_body,
        html_body = EXCLUDED.html_body,
        sent_at = EXCLUDED.sent_at,
        delivery_metadata = EXCLUDED.delivery_metadata
    RETURNING *`,
    [
      params.summaryDate,
      params.status,
      params.subject,
      params.textBody,
      params.htmlBody,
      params.sentAt || null,
      JSON.stringify(params.deliveryMetadata || {}),
    ],
  );
  return result.rows[0];
}

module.exports = {
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
  findApplicationsForApproval,
  findApprovedApplications,
  fetchApplicationDetail,
  fetchDashboardStats,
  upsertDailySummary,
};
