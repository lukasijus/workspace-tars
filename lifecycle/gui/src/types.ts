export type JsonMap = Record<string, unknown>;

export type Id = string | number;

export interface JobKeywordExtraction extends JsonMap {
  source?: string;
  hardSkills?: string[];
  frameworks?: string[];
  tools?: string[];
  domains?: string[];
  responsibilities?: string[];
  softSkills?: string[];
  senioritySignals?: string[];
  mustHave?: string[];
  niceToHave?: string[];
  atsKeywords?: string[];
  cvHeadlineHints?: string[];
  matchedCandidateStrengths?: string[];
  missingOrWeakSignals?: string[];
}

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
  description_text?: string | null;
  description_html?: string | null;
  description_fetched_at?: string | null;
  description_source_url?: string | null;
  keyword_extraction_status?: string | null;
  keyword_extracted_at?: string | null;
  keyword_extraction?: JobKeywordExtraction | null;
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

export interface AnswerDecisionRow {
  id: Id;
  application_id: Id;
  worker_run_id?: Id | null;
  question_key: string;
  question_text?: string | null;
  field_label?: string | null;
  field_type?: string | null;
  answer?: string | null;
  confidence?: number | string | null;
  source?: string | null;
  source_evidence?: string | null;
  reason?: string | null;
  risk_level?: string | null;
  should_auto_fill: boolean;
  requires_human_review: boolean;
  resolver_mode?: string | null;
  metadata?: JsonMap | null;
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
  answerDecisions: AnswerDecisionRow[];
  latestImageArtifact: ArtifactRow | null;
  latestHtmlArtifact: ArtifactRow | null;
  latestCvArtifact: ArtifactRow | null;
  availableActions: Record<string, boolean>;
}

export type SchedulerPhase =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SchedulerRunRecord {
  runNumber: number;
  status: "running" | "succeeded" | "failed" | "interrupted";
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  summary: unknown;
  error: string | null;
  stderrTail: string;
}

export interface SchedulerPersistedRunItem {
  id: Id;
  schedulerRunId: Id;
  workerRunId: Id | null;
  runNumber: number;
  status: "running" | "succeeded" | "failed" | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stderrTail: string | null;
  summary: unknown;
}

export interface SchedulerPersistedRun {
  id: Id;
  status: SchedulerPhase;
  totalRuns: number;
  completedRuns: number;
  itemsPerRun: number;
  gapMinutes: number;
  currentRun: number | null;
  startedAt: string | null;
  activeRunStartedAt: string | null;
  nextRunAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  lastError: string | null;
  summary: unknown;
  items: SchedulerPersistedRunItem[];
}

export interface SchedulerStatus {
  schedulerRunId: Id | null;
  running: boolean;
  phase: SchedulerPhase;
  totalRuns: number;
  completedRuns: number;
  currentRun: number | null;
  itemsPerRun: number;
  gapMinutes: number;
  startedAt: string | null;
  activeRunStartedAt: string | null;
  nextRunAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  lastResult: unknown;
  lastError: string | null;
  history: SchedulerRunRecord[];
  persistedRuns: SchedulerPersistedRun[];
}

export interface SchedulerStartRequest {
  runCount: number;
  itemsPerRun: number;
  gapMinutes: number;
}

export interface SettingsPayload {
  applicantFacts: string;
  applicantPolicy: string;
  applicantProfile: string;
}
