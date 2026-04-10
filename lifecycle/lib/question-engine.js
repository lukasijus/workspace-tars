const { config } = require("./config");
const { normalizeText, policyValue, truthyPolicyValue } = require("./applicant-policy");

const YES_OPTION_PATTERNS = [/^yes\b/i, /\bi do\b/i, /\bagree\b/i, /\baccept\b/i, /\bauthorized\b/i, /\beligible\b/i];
const NO_OPTION_PATTERNS = [/^no\b/i, /\bi do not\b/i, /\bdecline\b/i, /\bnot authorized\b/i, /\brequire sponsorship\b/i];

function joinValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return typeof value === "string" ? value.trim() : value || "";
}

function toBoolean(value, fallback = null) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function buildQuestionText(field = {}) {
  return [
    field.label,
    field.name,
    field.id,
    field.helpText,
    field.placeholder,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function buildQuestionKey(intent, field = {}) {
  const raw = normalizeText(buildQuestionText(field)).replace(/[^a-z0-9]+/g, "_");
  return intent || raw || "unknown_question";
}

function optionLabel(option) {
  return String(option?.label || option?.value || "").trim();
}

function hasYesNoOptions(field = {}) {
  const labels = (field.options || []).map((option) => normalizeText(optionLabel(option)));
  if (!labels.length) return false;
  const hits = labels.filter((label) =>
    YES_OPTION_PATTERNS.some((pattern) => pattern.test(label)) ||
    NO_OPTION_PATTERNS.some((pattern) => pattern.test(label)),
  );
  return hits.length >= 2;
}

function chooseBooleanOption(field, desiredBoolean) {
  const options = field.options || [];
  const patterns = desiredBoolean ? YES_OPTION_PATTERNS : NO_OPTION_PATTERNS;
  const exact = options.find((option) =>
    patterns.some((pattern) => pattern.test(optionLabel(option))),
  );
  if (exact) return optionLabel(exact);
  return desiredBoolean ? "YES" : "NO";
}

function skillFact(skillKey) {
  return Boolean(config.applicantFacts?.experience?.skills?.[skillKey]);
}

function inferSkillIntent(questionText) {
  if (/react/.test(questionText) && /type ?script/.test(questionText)) {
    return "experience.react_typescript_complex_apps";
  }

  if (/clickhouse/.test(questionText)) {
    return "experience.clickhouse_at_scale";
  }

  if (
    /\bgo\b/.test(questionText) &&
    /(distributed backend|backend systems|production experience|golang)/.test(questionText)
  ) {
    return "experience.distributed_backend_go";
  }

  if (
    /(data pipeline|data pipelines|telemetry|event data)/.test(questionText)
  ) {
    return "experience.high_scale_telemetry_pipelines";
  }

  const candidates = [
    { key: "experience.agentic_coding_tools", patterns: [/agentic coding/i, /ai coding tools/i, /copilot/i, /cursor/i, /claude code/i, /codex/i] },
    { key: "experience.javascript", patterns: [/\bjavascript\b/i] },
    { key: "experience.typescript", patterns: [/\btype ?script\b/i] },
    { key: "experience.react", patterns: [/\breact\b/i] },
    { key: "experience.python", patterns: [/\bpython\b/i] },
    { key: "experience.linux", patterns: [/\blinux\b/i] },
    { key: "experience.databases", patterns: [/\bdatabase(s)?\b/i, /\bsql\b/i] },
    { key: "experience.machine_vision", patterns: [/\bmachine vision\b/i, /\bcomputer vision\b/i] },
  ];

  const matched = candidates.find(({ patterns }) =>
    patterns.some((pattern) => pattern.test(questionText)),
  );
  return matched?.key || null;
}

function classifyIntent(field = {}) {
  const questionText = normalizeText(buildQuestionText(field));
  const booleanLike =
    field.type === "radio" ||
    field.type === "checkbox" ||
    field.type === "checkbox_group" ||
    hasYesNoOptions(field);

  const rulePairs = [
    ["identity.full_name", /\byour name\b|\bfull name\b|\blegal name\b/],
    ["identity.preferred_name", /\bpreferred name\b/],
    ["identity.first_name", /\bfirst name\b/],
    ["identity.last_name", /\blast name\b/],
    ["contact.email", /\bemail\b/],
    ["contact.phone_country_code", /phone country code|country code/],
    ["contact.phone", /mobile phone number|phone number|\bphone\b|\bmobile\b|telephone|nationalnumber/],
    ["links.linkedin_profile", /linkedin profile/],
    ["links.personal_website", /personal website|website|portfolio/],
    ["location.city", /\bcity\b|\blocation\b/],
    ["salary.desired", /desired salary|salary expectation|salary expectations|base salary|compensation/],
    ["authorization.citizenship_countries", /countries where you hold citizenship|citizenship/],
    ["authorization.permanent_residency_countries", /permanent residency|right to permanent residency|residency/],
    ["consent.read_privacy_notice", /read .*privacy notice/],
    ["consent.allow_future_roles", /considered for other job positions|future job positions|other job positions/],
    ["consent.personal_data", /personal data consent|data processing|privacy consent|gdpr|consent/i],
    ["consent.background_check", /background check|security checks/i],
    ["authorization.authorized_to_work", /authorized to work|legally authorized to work|eligible to work|right to work/],
    ["authorization.need_visa_sponsorship", /need visa sponsorship|require visa sponsorship|require sponsorship|need sponsorship/],
    ["location.cet_timezone_eligibility", /based in europe or israel|work cet timezone|cet timezone hours|europe or israel/],
  ];

  for (const [intent, pattern] of rulePairs) {
    if (pattern.test(questionText)) {
      return { intent, confidence: 0.98, questionText, booleanLike };
    }
  }

  if (booleanLike) {
    const skillIntent = inferSkillIntent(questionText);
    if (skillIntent) {
      return { intent: skillIntent, confidence: 0.85, questionText, booleanLike };
    }
  }

  return {
    intent: null,
    confidence: 0,
    questionText,
    booleanLike,
  };
}

function resolveIntentValue(intent, field = {}, application = null) {
  const profile = config.applicantProfile || {};
  const policy = config.applicantPolicy || {};
  const facts = config.applicantFacts || {};
  const fullName =
    String(profile.displayName || "").trim() ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const preferredName = String(profile.firstName || profile.displayName || "").trim();

  const resolved = (answer, source, confidence = 0.95) => ({
    answer,
    source,
    confidence,
  });

  switch (intent) {
    case "identity.full_name":
      return resolved(fullName, "profile");
    case "identity.preferred_name":
      return resolved(preferredName, "profile");
    case "identity.first_name":
      return resolved(profile.firstName || "", "profile");
    case "identity.last_name":
      return resolved(profile.lastName || "", "profile");
    case "contact.email":
      return resolved(profile.email || "", "profile");
    case "contact.phone_country_code":
      return resolved(profile.phoneCountryCode || "", "profile");
    case "contact.phone": {
      const normalized = String(profile.phoneLocal || "").trim();
      if (!normalized) return resolved("", null, 0);
      const search = normalizeText(buildQuestionText(field));
      const value =
        /nationalnumber|local/.test(search) && normalized.startsWith("0")
          ? normalized.replace(/^0+/, "") || normalized
          : normalized;
      return resolved(value, "profile");
    }
    case "links.linkedin_profile":
      return resolved(profile.linkedinProfileUrl || facts.links?.linkedinProfileUrl || "", profile.linkedinProfileUrl ? "profile" : "facts");
    case "links.personal_website":
      return resolved(
        facts.links?.personalWebsite || facts.links?.portfolioUrl || "",
        facts.links?.personalWebsite ? "facts" : facts.links?.portfolioUrl ? "facts" : null,
        0.9,
      );
    case "location.city":
      return resolved(profile.city || facts.location?.city || "", profile.city ? "profile" : "facts");
    case "salary.desired":
      return resolved(profile.desiredSalary || joinValue(facts.compensation?.desiredSalary) || "", profile.desiredSalary ? "profile" : "facts");
    case "authorization.citizenship_countries":
      return resolved(
        profile.citizenshipCountries || joinValue(facts.authorization?.citizenshipCountries) || "",
        profile.citizenshipCountries ? "profile" : "facts",
      );
    case "authorization.permanent_residency_countries":
      return resolved(
        profile.permanentResidencyCountries || joinValue(facts.authorization?.permanentResidencyCountries) || "",
        profile.permanentResidencyCountries ? "profile" : "facts",
      );
    case "consent.read_privacy_notice":
      return resolved(
        toBoolean(profile.policyRead, null) ?? facts.preferences?.readPrivacyNotice ?? toBoolean(policyValue(policy, "readPrivacyNotice"), true),
        profile.policyRead ? "profile" : facts.preferences?.readPrivacyNotice != null ? "facts" : "policy",
      );
    case "consent.allow_future_roles":
      return resolved(
        toBoolean(profile.policyAgree, null) ?? facts.preferences?.allowFutureRoles ?? toBoolean(policyValue(policy, "allowFutureRoles"), true),
        profile.policyAgree ? "profile" : facts.preferences?.allowFutureRoles != null ? "facts" : "policy",
      );
    case "consent.personal_data":
      return resolved(
        toBoolean(profile.policyPersonalDataConsent, null) ??
          facts.preferences?.personalDataConsent ??
          toBoolean(policyValue(policy, "personalDataConsent"), true),
        profile.policyPersonalDataConsent
          ? "profile"
          : facts.preferences?.personalDataConsent != null
            ? "facts"
            : "policy",
      );
    case "consent.background_check":
      return resolved(
        facts.preferences?.consentToBackgroundCheck ??
          toBoolean(policyValue(policy, "consentToBackgroundCheck"), true),
        facts.preferences?.consentToBackgroundCheck != null ? "facts" : "policy",
      );
    case "authorization.authorized_to_work":
      return resolved(
        facts.authorization?.authorizedToWork ??
          toBoolean(policyValue(policy, "authorizedToWork"), true),
        facts.authorization?.authorizedToWork != null ? "facts" : "policy",
      );
    case "authorization.need_visa_sponsorship":
      return resolved(
        facts.authorization?.needVisaSponsorship ??
          facts.authorization?.requireVisaSponsorship ??
          toBoolean(policyValue(policy, "needVisaSponsorship"), false),
        facts.authorization?.needVisaSponsorship != null ||
          facts.authorization?.requireVisaSponsorship != null
          ? "facts"
          : "policy",
      );
    case "location.cet_timezone_eligibility":
      return resolved(
        Boolean(
          facts.location?.basedInEuropeOrIsrael &&
            facts.location?.canWorkCetHours,
        ),
        "facts",
      );
    case "experience.react_typescript_complex_apps":
      return resolved(
        Boolean(
          facts.experience?.reactTypescriptComplexApps ||
            (skillFact("react") && skillFact("typescript")),
        ),
        "facts",
        0.85,
      );
    case "experience.agentic_coding_tools":
      return resolved(
        Boolean(
          facts.experience?.agenticCodingTools ||
            skillFact("agenticCodingTools"),
        ),
        "facts",
        0.85,
      );
    case "experience.clickhouse_at_scale":
      return resolved(Boolean(facts.experience?.clickhouseAtScale), "facts", 0.8);
    case "experience.distributed_backend_go":
      return resolved(Boolean(facts.experience?.distributedBackendSystemsGo), "facts", 0.8);
    case "experience.high_scale_telemetry_pipelines":
      return resolved(Boolean(facts.experience?.highScaleTelemetryPipelines), "facts", 0.8);
    case "experience.javascript":
      return resolved(skillFact("javascript"), "facts", 0.8);
    case "experience.typescript":
      return resolved(skillFact("typescript"), "facts", 0.8);
    case "experience.react":
      return resolved(skillFact("react"), "facts", 0.8);
    case "experience.python":
      return resolved(skillFact("python"), "facts", 0.8);
    case "experience.linux":
      return resolved(skillFact("linux"), "facts", 0.8);
    case "experience.databases":
      return resolved(Boolean(skillFact("databases") || skillFact("sql")), "facts", 0.8);
    case "experience.machine_vision":
      return resolved(
        Boolean(skillFact("machineVision") || skillFact("computerVision")),
        "facts",
        0.8,
      );
    case "document.resume":
      return resolved(application?.cv_variant_path || "", application?.cv_variant_path ? "application" : null, 1);
    default:
      return resolved("", null, 0);
  }
}

function coerceAnswerForField(field = {}, rawAnswer) {
  if (rawAnswer === null || rawAnswer === undefined) return "";
  if (field.type === "file") return String(rawAnswer || "");
  if (typeof rawAnswer === "boolean") {
    return chooseBooleanOption(field, rawAnswer);
  }

  const answer = joinValue(rawAnswer);
  if (!answer) return "";
  if (["radio", "checkbox", "checkbox_group", "select"].includes(field.type)) {
    const boolValue = toBoolean(answer, null);
    if (boolValue !== null) {
      return chooseBooleanOption(field, boolValue);
    }

    const wanted = normalizeText(answer);
    const exact = (field.options || []).find((option) => {
      const label = normalizeText(optionLabel(option));
      return label === wanted || label.includes(wanted) || wanted.includes(label);
    });
    if (exact) return optionLabel(exact);
  }

  return String(answer);
}

function resolveFieldAnswer(field = {}, options = {}) {
  const application = options.application || null;

  if (field.type === "file") {
    const filePath = application?.cv_variant_path || "";
    return {
      intent: "document.resume",
      questionKey: "document.resume",
      questionText: buildQuestionText(field),
      answer: filePath,
      source: filePath ? "application" : null,
      confidence: filePath ? 1 : 0,
      autoAnswerable: Boolean(filePath),
    };
  }

  const classification = classifyIntent(field);
  const resolved = classification.intent
    ? resolveIntentValue(classification.intent, field, application)
    : { answer: "", source: null, confidence: 0 };
  const coercedAnswer = coerceAnswerForField(field, resolved.answer);
  const autoAnswerable = Boolean(coercedAnswer);

  return {
    intent: classification.intent,
    questionKey: buildQuestionKey(classification.intent, field),
    questionText: classification.questionText,
    answer: coercedAnswer,
    source: resolved.source,
    confidence: classification.confidence
      ? Math.min(classification.confidence, resolved.confidence || classification.confidence)
      : resolved.confidence || 0,
    autoAnswerable,
  };
}

function annotateResolvedField(field = {}, options = {}) {
  const resolution = resolveFieldAnswer(field, options);
  return {
    ...field,
    questionIntent: resolution.intent,
    questionKey: resolution.questionKey,
    resolvedAnswer: resolution.answer || null,
    resolutionSource: resolution.source || null,
    resolutionConfidence: resolution.confidence || 0,
    autoAnswerable: resolution.autoAnswerable,
  };
}

module.exports = {
  buildQuestionText,
  classifyIntent,
  resolveFieldAnswer,
  annotateResolvedField,
  coerceAnswerForField,
};
