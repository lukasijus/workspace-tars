import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./httpError";
import {
  APPLICATION_STATUS,
  APPROVAL_STATE,
  FLOW_TYPE,
  applicationDiscovery,
  config,
  db,
  repository,
  submitApprovedModule,
} from "./legacy";
import type { ApplicationDetail, ApplicationId, ApplicationRow, ArtifactRow } from "./types";

const { query, withTransaction } = db;
const {
  createArtifact,
  fetchApplicationDetail,
  fetchDashboardStats,
  findApplicationsForApproval,
  insertApplicationStep,
  setApprovalState,
  updateApplicationStatus,
  updateJobAvailability,
} = repository;
const { discoverApplicationFlow } = applicationDiscovery;
const { runSubmitApproved } = submitApprovedModule;

const IMAGE_ARTIFACT_KINDS = new Set(["submission_screenshot", "discovery_screenshot"]);
const HTML_ARTIFACT_KINDS = new Set(["submission_html", "discovery_html"]);
const CV_ARTIFACT_KINDS = new Set(["cv_variant_pdf"]);

export function summarizeRowReason(row: ApplicationRow): string {
  if (row.is_active === false && row.inactive_reason) {
    return row.inactive_reason;
  }

  return String(
    row.last_error ||
      row.draft_payload?.reason ||
      row.draft_payload?.externalStep?.stepTitle ||
      row.latest_step_reason ||
      "",
  );
}

export function summarizeRow(row: ApplicationRow): ApplicationRow & { summary_reason: string } {
  return {
    ...row,
    summary_reason: summarizeRowReason(row),
  };
}

async function fetchApplicationsByStatus(status: string, limit = 20): Promise<ApplicationRow[]> {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url,
      jobs.source_job_id,
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
  return result.rows.map(summarizeRow);
}

async function fetchRecentApplications(limit = 25): Promise<ApplicationRow[]> {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url,
      jobs.source_job_id,
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
  return result.rows.map(summarizeRow);
}

async function fetchRetryDiscoveryCandidates(limit = 100): Promise<ApplicationRow[]> {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url,
      jobs.source_job_id,
      jobs.is_active,
      jobs.inactive_reason
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    WHERE jobs.is_active IS DISTINCT FROM FALSE
      AND applications.status IN ($1, $2)
    ORDER BY applications.updated_at DESC
    LIMIT $3`,
    [
      APPLICATION_STATUS.FAILED,
      APPLICATION_STATUS.NEEDS_HUMAN_INPUT,
      limit,
    ],
  );
  return result.rows.map(summarizeRow);
}

export async function fetchApplicationRow(applicationId: ApplicationId): Promise<ApplicationRow | null> {
  const result = await query(
    `SELECT
      applications.*,
      jobs.company,
      jobs.title,
      jobs.location,
      jobs.source_url,
      jobs.source_job_id,
      jobs.is_active,
      jobs.inactive_reason
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    WHERE applications.id = $1`,
    [applicationId],
  );
  return result.rows[0] ? summarizeRow(result.rows[0]) : null;
}

export async function fetchArtifactRow(artifactId: ApplicationId): Promise<ArtifactRow | null> {
  const result = await query(
    `SELECT *
    FROM artifacts
    WHERE id = $1`,
    [artifactId],
  );
  return result.rows[0] || null;
}

export function inferMimeType(filePath: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".json") return "application/json; charset=utf-8";
  return fallback;
}

export function assertArtifactReadable(artifact: ArtifactRow): void {
  if (!artifact.file_path || !fs.existsSync(artifact.file_path)) {
    throw new HttpError(404, "Artifact file is missing.");
  }
}

function findLatestArtifact(artifacts: ArtifactRow[], kinds: Set<string>): ArtifactRow | null {
  return artifacts.find((artifact) => kinds.has(artifact.kind)) || null;
}

function availableActions(application: ApplicationRow): Record<string, boolean> {
  const active = application.is_active !== false;
  return {
    approve: application.status === APPLICATION_STATUS.PENDING_APPROVAL,
    reject: application.status === APPLICATION_STATUS.PENDING_APPROVAL,
    retryDiscovery: active,
    markInactive: active,
    markSubmitted: application.status !== APPLICATION_STATUS.SUBMITTED,
    submitNow: application.status === APPLICATION_STATUS.APPROVED && active,
  };
}

export async function fetchDashboard() {
  const dbClient = { query };
  const [stats, pendingRows, needsHumanInput, recentApplications, retryCandidates] =
    await Promise.all([
      fetchDashboardStats(dbClient),
      findApplicationsForApproval(dbClient, 25),
      fetchApplicationsByStatus(APPLICATION_STATUS.NEEDS_HUMAN_INPUT, 20),
      fetchRecentApplications(20),
      fetchRetryDiscoveryCandidates(100),
    ]);

  return {
    ok: true,
    stats,
    actions: {
      approvedCount: stats.applicationCounts.approved || 0,
      retryableDiscoveryCount: retryCandidates.length,
    },
    pendingApproval: pendingRows.map(summarizeRow),
    needsHumanInput,
    recentApplications,
  };
}

export async function fetchApplication(applicationId: ApplicationId): Promise<ApplicationDetail> {
  const detail = await withTransaction((client: any) =>
    fetchApplicationDetail(client, Number(applicationId)),
  );

  if (!detail) {
    throw new HttpError(404, "Application not found.");
  }

  return {
    application: summarizeRow(detail.application),
    steps: detail.steps,
    artifacts: detail.artifacts,
    latestImageArtifact: findLatestArtifact(detail.artifacts, IMAGE_ARTIFACT_KINDS),
    latestHtmlArtifact: findLatestArtifact(detail.artifacts, HTML_ARTIFACT_KINDS),
    latestCvArtifact: findLatestArtifact(detail.artifacts, CV_ARTIFACT_KINDS),
    availableActions: availableActions(detail.application),
  };
}

function decideDiscoveryOutcome(discovery: any) {
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

  if (discovery.readiness === "ready_for_approval") {
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

  if (discovery.readiness === "needs_human_input") {
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

async function runRetryDiscoveryForApplication(current: ApplicationRow) {
  if (!current || current.is_active === false) {
    return null;
  }

  const discovery = await discoverApplicationFlow(
    {
      jobId: current.source_job_id,
      title: current.title,
      link: current.source_url,
    },
    {
      headed: false,
      application: current,
    },
  );
  const outcome = decideDiscoveryOutcome(discovery);

  await withTransaction(async (client: any) => {
    const updated = await updateApplicationStatus(client, current.id, {
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

    await updateJobAvailability(client, current.job_id, {
      isActive: discovery.jobActive !== false,
      reason: discovery.inactiveReason || discovery.reason || null,
    });

    await insertApplicationStep(
      client,
      current.id,
      null,
      "discovery",
      outcome.status,
      {
        actor: "dashboard_retry",
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
        entityType: "application",
        entityId: updated.id,
        kind: "discovery_screenshot",
        filePath: discovery.artifacts.screenshotPath,
        mimeType: "image/png",
        metadata: {
          flowType: discovery.flowType,
          actor: "dashboard_retry",
        },
      });
    }

    if (discovery.artifacts?.htmlPath) {
      await createArtifact(client, {
        entityType: "application",
        entityId: updated.id,
        kind: "discovery_html",
        filePath: discovery.artifacts.htmlPath,
        mimeType: "text/html",
        metadata: {
          flowType: discovery.flowType,
          actor: "dashboard_retry",
        },
      });
    }

    if (outcome.approvalState === APPROVAL_STATE.PENDING) {
      await setApprovalState(client, updated.id, {
        state: APPROVAL_STATE.PENDING,
        actor: "dashboard_retry",
        reason: "Discovery retry found a submission-ready flow",
      });
      await insertApplicationStep(
        client,
        updated.id,
        null,
        "approval",
        APPLICATION_STATUS.PENDING_APPROVAL,
        {
          actor: "dashboard_retry",
          reason: "Discovery retry found a submission-ready flow",
        },
      );
    }

    if (outcome.approvalState === APPROVAL_STATE.APPROVED) {
      await setApprovalState(client, updated.id, {
        state: APPROVAL_STATE.APPROVED,
        actor: "dashboard_retry",
        reason: "Discovery retry auto-approved by applicant policy",
      });
      await insertApplicationStep(
        client,
        updated.id,
        null,
        "approval",
        APPLICATION_STATUS.APPROVED,
        {
          actor: "dashboard_retry",
          reason: "Discovery retry auto-approved by applicant policy",
        },
      );
    }
  });

  return {
    id: current.id,
    status: outcome.status,
    approvalState: outcome.approvalState,
    flowType: discovery.flowType,
    reason: discovery.reason || null,
  };
}

export async function approveApplication(applicationId: ApplicationId, reason?: string) {
  return setApplicationApproval(applicationId, "approve", reason);
}

export async function rejectApplication(applicationId: ApplicationId, reason?: string) {
  return setApplicationApproval(applicationId, "reject", reason);
}

async function setApplicationApproval(
  applicationId: ApplicationId,
  action: "approve" | "reject",
  reason?: string,
) {
  const current = await fetchApplicationRow(applicationId);

  if (!current) {
    throw new HttpError(404, "Application not found.");
  }

  if (action === "approve" && current.status !== APPLICATION_STATUS.PENDING_APPROVAL) {
    throw new HttpError(
      409,
      `This application is ${current.status}, not ${APPLICATION_STATUS.PENDING_APPROVAL}.`,
    );
  }

  const approvalReason =
    reason ||
    (action === "approve"
      ? "Approved from local dashboard"
      : "Rejected from local dashboard");

  await withTransaction(async (client: any) => {
    const application = await setApprovalState(client, applicationId, {
      state: action === "approve" ? APPROVAL_STATE.APPROVED : APPROVAL_STATE.REJECTED,
      actor: "dashboard",
      reason: approvalReason,
    });
    await insertApplicationStep(
      client,
      application.id,
      null,
      "approval",
      application.status,
      {
        actor: "dashboard",
        reason: approvalReason,
      },
    );
  });

  return fetchApplication(applicationId);
}

export async function retryDiscovery(applicationId: ApplicationId) {
  const current = await fetchApplicationRow(applicationId);
  if (!current) {
    throw new HttpError(404, "Application not found.");
  }

  if (current.is_active === false) {
    throw new HttpError(
      409,
      current.inactive_reason || "This job is marked inactive.",
    );
  }

  const result = await runRetryDiscoveryForApplication(current);
  return {
    ok: true,
    action: "retry_discovery",
    result,
    detail: await fetchApplication(applicationId),
  };
}

export async function retryDiscoveryAll() {
  const candidates = await fetchRetryDiscoveryCandidates(100);
  const results = [];

  for (const candidate of candidates) {
    results.push(await runRetryDiscoveryForApplication(candidate));
  }

  return {
    ok: true,
    action: "retry_discovery_all",
    attempted: candidates.length,
    results,
  };
}

export async function markInactive(applicationId: ApplicationId, reason?: string) {
  const current = await fetchApplicationRow(applicationId);

  if (!current) {
    throw new HttpError(404, "Application not found.");
  }

  const inactiveReason = reason?.trim() || "Manually marked inactive from dashboard";

  await withTransaction(async (client: any) => {
    await updateJobAvailability(client, current.job_id, {
      isActive: false,
      reason: inactiveReason,
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
      lastError: current.status === APPLICATION_STATUS.SUBMITTED ? current.last_error : inactiveReason,
      draftPayload: {
        reason: inactiveReason,
        manuallyMarkedInactive: true,
      },
      workerRunId: null,
    });

    await insertApplicationStep(
      client,
      applicationId,
      null,
      "operator",
      nextStatus,
      {
        actor: "dashboard",
        action: "mark_inactive",
        reason: inactiveReason,
      },
    );
  });

  return fetchApplication(applicationId);
}

export async function markSubmitted(applicationId: ApplicationId, reason?: string) {
  const current = await fetchApplicationRow(applicationId);

  if (!current) {
    throw new HttpError(404, "Application not found.");
  }

  const submittedReason = reason?.trim() || "Manually marked submitted from dashboard";

  await withTransaction(async (client: any) => {
    await updateApplicationStatus(client, applicationId, {
      status: APPLICATION_STATUS.SUBMITTED,
      approvalState: APPROVAL_STATE.APPROVED,
      lastError: null,
      draftPayload: {
        reason: submittedReason,
        manuallyMarkedSubmitted: true,
      },
      workerRunId: null,
      markSubmissionAttempted: true,
      markSubmitted: true,
    });

    await insertApplicationStep(
      client,
      applicationId,
      null,
      "operator",
      APPLICATION_STATUS.SUBMITTED,
      {
        actor: "dashboard",
        action: "mark_submitted",
        reason: submittedReason,
      },
    );
  });

  return fetchApplication(applicationId);
}

export async function submitApproved(applicationId?: ApplicationId) {
  if (applicationId) {
    const current = await fetchApplicationRow(applicationId);
    if (!current) {
      throw new HttpError(404, "Application not found.");
    }

    if (current.status !== APPLICATION_STATUS.APPROVED) {
      throw new HttpError(
        409,
        `This application is ${current.status}, not ${APPLICATION_STATUS.APPROVED}.`,
      );
    }
  }

  const result = await runSubmitApproved({
    applicationIds: applicationId ? [applicationId] : [],
    limit: applicationId ? 1 : config.searchBatchSize,
    source: "dashboard",
  });

  return {
    ok: true,
    action: "submit_approved",
    result,
    detail: applicationId ? await fetchApplication(applicationId) : null,
  };
}
