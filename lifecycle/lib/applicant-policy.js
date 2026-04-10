const fs = require("fs");

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function loadApplicantPolicy(policyPath) {
  if (!policyPath || !fs.existsSync(policyPath)) {
    return {
      version: 1,
      approval: {
        externalAutoApprove: false,
      },
      external: {
        maxSteps: 8,
        maxSameFingerprint: 2,
        defaultYesNo: "YES",
      },
      defaults: {},
    };
  }

  const payload = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  return {
    version: payload.version || 1,
    approval: {
      externalAutoApprove: Boolean(payload?.approval?.externalAutoApprove),
    },
    external: {
      maxSteps: Number(payload?.external?.maxSteps) || 8,
      maxSameFingerprint: Number(payload?.external?.maxSameFingerprint) || 2,
      defaultYesNo: payload?.external?.defaultYesNo || "YES",
    },
    defaults: payload?.defaults || {},
  };
}

function policyValue(policy, key, fallback = "") {
  const value = policy?.defaults?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function truthyPolicyValue(value, fallback = "YES") {
  const normalized = normalizeText(value || fallback);
  if (!normalized) return fallback;
  if (["yes", "true", "1", "on"].includes(normalized)) return "YES";
  if (["no", "false", "0", "off"].includes(normalized)) return "NO";
  return value || fallback;
}

module.exports = {
  loadApplicantPolicy,
  normalizeText,
  policyValue,
  truthyPolicyValue,
};
