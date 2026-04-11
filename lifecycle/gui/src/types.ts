export type JsonMap = Record<string, unknown>;

export type Id = string | number;

export interface ApplicationRow {
  id: Id;
  job_id: Id;
  status: string;
  flow_type: string;
  approval_state: string;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  source_url?: string | null;
  external_apply_url?: string | null;
  cv_variant_file_name?: string | null;
  draft_payload?: JsonMap | null;
  discovered_fields?: unknown;
  last_error?: string | null;
  retry_count?: number | null;
  submitted_at?: string | null;
  submission_attempted_at?: string | null;
  updated_at?: string | null;
  is_active?: boolean | null;
  inactive_reason?: string | null;
  latest_step_reason?: string | null;
  latest_image_artifact_id?: Id | null;
  latest_image_path?: string | null;
  latest_html_artifact_id?: Id | null;
  latest_html_path?: string | null;
  summary_reason?: string | null;
}

export interface ArtifactRow {
  id: Id;
  entity_type: string;
  entity_id: Id;
  kind: string;
  file_path: string;
  mime_type?: string | null;
  metadata?: JsonMap | null;
  created_at?: string | null;
}

export interface ApplicationStepRow {
  id: Id;
  application_id: Id;
  worker_run_id?: Id | null;
  step: string;
  status: string;
  details?: JsonMap | null;
  created_at?: string | null;
}

export interface DashboardStats {
  applicationCounts: Record<string, number>;
  submittedToday: number;
  failedToday: number;
  recentRuns: JsonMap[];
}

export interface DashboardData {
  ok: true;
  stats: DashboardStats;
  actions: {
    approvedCount: number;
    retryableDiscoveryCount: number;
  };
  pendingApproval: ApplicationRow[];
  needsHumanInput: ApplicationRow[];
  recentApplications: ApplicationRow[];
}

export interface ApplicationDetail {
  application: ApplicationRow;
  artifacts: ArtifactRow[];
  steps: ApplicationStepRow[];
  latestImageArtifact: ArtifactRow | null;
  latestHtmlArtifact: ArtifactRow | null;
  availableActions: Record<string, boolean>;
}
