export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ApplicationId = number | string;

export interface ApplicationRow {
  id: ApplicationId;
  job_id: ApplicationId;
  status: string;
  flow_type: string;
  approval_state: string;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  source_url?: string | null;
  source_job_id?: string | null;
  description_text?: string | null;
  description_html?: string | null;
  description_fetched_at?: string | Date | null;
  description_source_url?: string | null;
  keyword_extraction_status?: string | null;
  keyword_extracted_at?: string | Date | null;
  keyword_extraction?: Record<string, any> | null;
  external_apply_url?: string | null;
  cv_variant_path?: string | null;
  cv_variant_file_name?: string | null;
  draft_payload?: Record<string, any> | null;
  discovered_fields?: unknown[] | Record<string, any> | null;
  last_error?: string | null;
  retry_count?: number | null;
  submitted_at?: string | Date | null;
  submission_attempted_at?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  is_active?: boolean | null;
  inactive_reason?: string | null;
  inactive_detected_at?: string | Date | null;
  latest_step_reason?: string | null;
  latest_image_artifact_id?: ApplicationId | null;
  latest_image_path?: string | null;
  latest_html_artifact_id?: ApplicationId | null;
  latest_html_path?: string | null;
  [key: string]: unknown;
}

export interface ArtifactRow {
  id: ApplicationId;
  entity_type: string;
  entity_id: ApplicationId;
  kind: string;
  file_path: string;
  mime_type?: string | null;
  metadata?: Record<string, any> | null;
  created_at?: string | Date | null;
}

export interface ApplicationStepRow {
  id: ApplicationId;
  application_id: ApplicationId;
  worker_run_id?: ApplicationId | null;
  step: string;
  status: string;
  details?: Record<string, any> | null;
  created_at?: string | Date | null;
}

export interface AnswerDecisionRow {
  id: ApplicationId;
  application_id: ApplicationId;
  worker_run_id?: ApplicationId | null;
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
  metadata?: Record<string, any> | null;
  created_at?: string | Date | null;
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
