const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(WORKSPACE_ROOT, ".env");

if (fs.existsSync(ENV_PATH)) {
  dotenv.config({ path: ENV_PATH });
}

const OUTPUT_ROOT = path.join(WORKSPACE_ROOT, "lifecycle", "output");
const ARTIFACT_ROOT = path.join(OUTPUT_ROOT, "artifacts");
const REPORT_ROOT = path.join(OUTPUT_ROOT, "reports");
const DISCOVERY_ROOT = path.join(OUTPUT_ROOT, "discovery");

function envString(key, fallback = "") {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envInteger(key, fallback) {
  const raw = process.env[key];
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envBoolean(key, fallback = false) {
  const raw = process.env[key];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function deriveNameParts(displayName) {
  const parts = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

const candidateDisplayName = envString(
  "TARS_CANDIDATE_DISPLAY_NAME",
  "Candidate Name",
);
const derivedNameParts = deriveNameParts(candidateDisplayName);

const config = {
  workspaceRoot: WORKSPACE_ROOT,
  envPath: ENV_PATH,
  outputRoot: OUTPUT_ROOT,
  artifactRoot: ARTIFACT_ROOT,
  reportRoot: REPORT_ROOT,
  discoveryRoot: DISCOVERY_ROOT,
  databaseUrl: envString(
    "TARS_LIFECYCLE_DATABASE_URL",
    envString("DATABASE_URL"),
  ),
  dashboardHost: envString("TARS_LIFECYCLE_DASHBOARD_HOST", "127.0.0.1"),
  dashboardPort: envInteger("TARS_LIFECYCLE_DASHBOARD_PORT", 4310),
  searchBatchSize: envInteger("TARS_LIFECYCLE_SEARCH_BATCH_SIZE", 5),
  discoveryLimit: envInteger("TARS_LIFECYCLE_DISCOVERY_LIMIT", 5),
  maxApplicationRetries: envInteger(
    "TARS_LIFECYCLE_MAX_APPLICATION_RETRIES",
    2,
  ),
  runTimeoutMinutes: envInteger("TARS_LIFECYCLE_RUN_TIMEOUT_MINUTES", 20),
  staleRunMinutes: envInteger("TARS_LIFECYCLE_STALE_RUN_MINUTES", 30),
  summaryEmailTo: envString("TARS_LIFECYCLE_SUMMARY_EMAIL_TO"),
  summaryEmailFrom: envString("TARS_LIFECYCLE_SUMMARY_EMAIL_FROM"),
  smtpHost: envString("TARS_LIFECYCLE_SUMMARY_SMTP_HOST"),
  smtpPort: envInteger("TARS_LIFECYCLE_SUMMARY_SMTP_PORT", 465),
  smtpSecure: envBoolean("TARS_LIFECYCLE_SUMMARY_SMTP_SECURE", true),
  smtpUser: envString("TARS_LIFECYCLE_SUMMARY_SMTP_USER"),
  smtpPass: envString("TARS_LIFECYCLE_SUMMARY_SMTP_PASS"),
  applicantProfile: {
    displayName: candidateDisplayName,
    firstName: envString(
      "TARS_APPLICANT_FIRST_NAME",
      derivedNameParts.firstName,
    ),
    lastName: envString("TARS_APPLICANT_LAST_NAME", derivedNameParts.lastName),
    linkedinProfileUrl: envString("TARS_APPLICANT_LINKEDIN_PROFILE_URL"),
    email: envString("TARS_APPLICANT_EMAIL"),
    phoneLocal: envString("TARS_APPLICANT_PHONE_LOCAL"),
    phoneCountryCode: envString("TARS_APPLICANT_PHONE_COUNTRY_CODE"),
    city: envString("TARS_APPLICANT_CITY"),
    desiredSalary: envString("TARS_APPLICANT_DESIRED_SALARY"),
    citizenshipCountries: envString("TARS_APPLICANT_CITIZENSHIP_COUNTRIES"),
    permanentResidencyCountries: envString(
      "TARS_APPLICANT_PERMANENT_RESIDENCY_COUNTRIES",
    ),
    policyRead: envString("TARS_APPLICANT_READ_PRIVACY_APPROVED"),
    policyAgree: envString("TARS_APPLICANT_AGREE_PRIVACY"),
    policyPersonalDataConsent: envString(
      "TARS_APPLICANT_PERSONAL_DATA_CONSENT",
    ),
  },
};

function assertDatabaseUrl() {
  if (!config.databaseUrl) {
    throw new Error(
      "Missing lifecycle database configuration. Set TARS_LIFECYCLE_DATABASE_URL in .env.",
    );
  }
}

module.exports = {
  config,
  assertDatabaseUrl,
};
