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
      metadata,
      description_text,
      description_html,
      description_fetched_at,
      description_source_url,
      keyword_extraction_status,
      keyword_extracted_at,
      keyword_extraction
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10::jsonb, $11::jsonb, NOW(), $12, $13, $14::jsonb,
      $15, $16, $17, $18, $19, $20, $21::jsonb
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
        metadata = COALESCE(jobs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        description_text = COALESCE(EXCLUDED.description_text, jobs.description_text),
        description_html = COALESCE(EXCLUDED.description_html, jobs.description_html),
        description_fetched_at = COALESCE(EXCLUDED.description_fetched_at, jobs.description_fetched_at),
        description_source_url = COALESCE(EXCLUDED.description_source_url, jobs.description_source_url),
        keyword_extraction_status = CASE
          WHEN EXCLUDED.keyword_extraction_status = 'not_started' THEN jobs.keyword_extraction_status
          ELSE EXCLUDED.keyword_extraction_status
        END,
        keyword_extracted_at = COALESCE(EXCLUDED.keyword_extracted_at, jobs.keyword_extracted_at),
        keyword_extraction = CASE
          WHEN EXCLUDED.keyword_extraction = '{}'::jsonb THEN jobs.keyword_extraction
          ELSE EXCLUDED.keyword_extraction
        END
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
        descriptionFetchStatus: job.descriptionFetchStatus || null,
        descriptionError: job.descriptionError || null,
      }),
      job.descriptionText || null,
      job.descriptionHtml || null,
      job.descriptionFetchedAt || null,
      job.descriptionSourceUrl || job.link || null,
      job.keywordExtractionStatus || (job.keywordExtraction ? 'deterministic' : 'not_started'),
      job.keywordExtractedAt || null,
      JSON.stringify(job.keywordExtraction || {}),
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

async function insertApplicationAnswerDecisions(client, applicationId, workerRunId, decisions = []) {
  const rows = [];
  for (const decision of decisions || []) {
    if (!decision || typeof decision !== 'object') continue;
    const result = await client.query(
      `INSERT INTO application_answer_decisions (
        application_id,
        worker_run_id,
        question_key,
        question_text,
        field_label,
        field_type,
        answer,
        confidence,
        source,
        source_evidence,
        reason,
        risk_level,
        should_auto_fill,
        requires_human_review,
        resolver_mode,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16::jsonb
      )
      RETURNING *`,
      [
        applicationId,
        workerRunId || null,
        decision.questionKey || 'unknown_question',
        decision.questionText || null,
        decision.fieldLabel || null,
        decision.fieldType || null,
        decision.answer == null ? null : String(decision.answer),
        Number.isFinite(Number(decision.confidence)) ? Number(decision.confidence) : null,
        decision.source || null,
        decision.sourceEvidence || null,
        decision.reason || null,
        decision.riskLevel || null,
        Boolean(decision.shouldAutoFill),
        Boolean(decision.requiresHumanReview),
        decision.resolverMode || null,
        JSON.stringify(decision.metadata || {}),
      ],
    );
    rows.push(result.rows[0]);
  }
  return rows;
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

async function findApprovedApplications(client, limit = 20, applicationIds = []) {
  const ids = Array.isArray(applicationIds)
    ? applicationIds.map((value) => Number(value)).filter(Number.isInteger)
    : [];
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
      AND (
        COALESCE(array_length($3::int[], 1), 0) = 0
        OR applications.id = ANY($3::int[])
      )
    ORDER BY applications.updated_at ASC
    LIMIT $2`,
    [APPLICATION_STATUS.APPROVED, limit, ids],
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
      jobs.description_text,
      jobs.description_html,
      jobs.description_fetched_at,
      jobs.description_source_url,
      jobs.keyword_extraction_status,
      jobs.keyword_extracted_at,
      jobs.keyword_extraction,
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

  const [steps, artifacts, answerDecisions] = await Promise.all([
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
    client.query(
      `SELECT *
      FROM application_answer_decisions
      WHERE application_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
      [applicationId],
    ),
  ]);

  return {
    application: application.rows[0],
    steps: steps.rows,
    artifacts: artifacts.rows,
    answerDecisions: answerDecisions.rows,
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

async function createSchedulerRun(client, params) {
  const result = await client.query(
    `INSERT INTO scheduler_runs (
      status,
      total_runs,
      completed_runs,
      items_per_run,
      gap_minutes,
      current_run,
      started_at,
      summary
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::jsonb)
    RETURNING *`,
    [
      params.status,
      params.totalRuns,
      params.completedRuns || 0,
      params.itemsPerRun,
      params.gapMinutes || 0,
      params.currentRun || null,
      JSON.stringify(params.summary || {}),
    ],
  );
  return result.rows[0];
}

async function updateSchedulerRun(client, schedulerRunId, params = {}) {
  const sets = ['updated_at = NOW()'];
  const values = [schedulerRunId];
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (Object.prototype.hasOwnProperty.call(params, 'status')) {
    sets.push(`status = ${addValue(params.status)}`);
  }
  if (Object.prototype.hasOwnProperty.call(params, 'completedRuns')) {
    sets.push(`completed_runs = ${addValue(params.completedRuns)}`);
  }
  if (Object.prototype.hasOwnProperty.call(params, 'currentRun')) {
    sets.push(`current_run = ${addValue(params.currentRun)}`);
  }
  if (Object.prototype.hasOwnProperty.call(params, 'activeRunStartedAt')) {
    sets.push(`active_run_started_at = ${addValue(params.activeRunStartedAt)}`);
  }
  if (Object.prototype.hasOwnProperty.call(params, 'nextRunAt')) {
    sets.push(`next_run_at = ${addValue(params.nextRunAt)}`);
  }
  if (params.markFinished) {
    sets.push('finished_at = NOW()');
  }
  if (params.cancelRequested) {
    sets.push('cancel_requested = TRUE');
  }
  if (Object.prototype.hasOwnProperty.call(params, 'lastError')) {
    sets.push(`last_error = ${addValue(params.lastError)}`);
  }
  if (Object.prototype.hasOwnProperty.call(params, 'summary')) {
    sets.push(`summary = COALESCE(summary, '{}'::jsonb) || ${addValue(JSON.stringify(params.summary || {}))}::jsonb`);
  }

  const result = await client.query(
    `UPDATE scheduler_runs
    SET ${sets.join(',\n        ')}
    WHERE id = $1
    RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function createSchedulerRunItem(client, params) {
  const result = await client.query(
    `INSERT INTO scheduler_run_items (
      scheduler_run_id,
      run_number,
      status,
      started_at,
      summary
    ) VALUES ($1, $2, $3, NOW(), $4::jsonb)
    ON CONFLICT (scheduler_run_id, run_number) DO UPDATE
    SET status = EXCLUDED.status,
        started_at = NOW(),
        finished_at = NULL,
        duration_ms = NULL,
        exit_code = NULL,
        signal = NULL,
        error = NULL,
        stderr_tail = NULL,
        summary = EXCLUDED.summary,
        updated_at = NOW()
    RETURNING *`,
    [
      params.schedulerRunId,
      params.runNumber,
      params.status,
      JSON.stringify(params.summary || {}),
    ],
  );
  return result.rows[0];
}

async function finishSchedulerRunItem(client, schedulerRunItemId, params = {}) {
  const result = await client.query(
    `UPDATE scheduler_run_items
    SET status = $2,
        worker_run_id = COALESCE($3, worker_run_id),
        finished_at = NOW(),
        duration_ms = GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::bigint
        ),
        exit_code = $4,
        signal = $5,
        error = $6,
        stderr_tail = $7,
        summary = COALESCE(summary, '{}'::jsonb) || $8::jsonb,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *`,
    [
      schedulerRunItemId,
      params.status,
      params.workerRunId || null,
      typeof params.exitCode === 'number' ? params.exitCode : null,
      params.signal || null,
      params.error || null,
      params.stderrTail || null,
      JSON.stringify(params.summary || {}),
    ],
  );
  return result.rows[0];
}

async function markInterruptedSchedulerRuns(client) {
  const childResult = await client.query(
    `UPDATE scheduler_run_items
    SET status = 'interrupted',
        finished_at = COALESCE(finished_at, NOW()),
        duration_ms = CASE
          WHEN duration_ms IS NULL THEN GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::bigint
          )
          ELSE duration_ms
        END,
        error = COALESCE(error, 'Dashboard server restarted before scheduler completed.'),
        updated_at = NOW()
    WHERE status = 'running'
      AND scheduler_run_id IN (
        SELECT id
        FROM scheduler_runs
        WHERE status IN ('running', 'waiting')
      )
    RETURNING *`,
  );

  const result = await client.query(
    `UPDATE scheduler_runs
    SET status = 'interrupted',
        finished_at = COALESCE(finished_at, NOW()),
        next_run_at = NULL,
        active_run_started_at = NULL,
        current_run = NULL,
        last_error = COALESCE(last_error, 'Dashboard server restarted before scheduler completed.'),
        updated_at = NOW()
    WHERE status IN ('running', 'waiting')
    RETURNING *`,
  );
  return {
    schedulerRuns: result.rows,
    schedulerRunItems: childResult.rows,
  };
}

async function fetchSchedulerRuns(client, limit = 20) {
  const result = await client.query(
    `SELECT
      scheduler_runs.*,
      COALESCE(items.items, '[]'::jsonb) AS items
    FROM scheduler_runs
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(scheduler_run_items.*) ORDER BY run_number ASC) AS items
      FROM scheduler_run_items
      WHERE scheduler_run_id = scheduler_runs.id
    ) AS items ON TRUE
    ORDER BY scheduler_runs.started_at DESC
    LIMIT $1`,
    [limit],
  );
  return result.rows;
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
  insertApplicationAnswerDecisions,
  setApprovalState,
  findApplicationsForApproval,
  findApprovedApplications,
  fetchApplicationDetail,
  fetchDashboardStats,
  upsertDailySummary,
  createSchedulerRun,
  updateSchedulerRun,
  createSchedulerRunItem,
  finishSchedulerRunItem,
  markInterruptedSchedulerRuns,
  fetchSchedulerRuns,
};
