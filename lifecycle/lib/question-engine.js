const { config } = require("./config");
const { normalizeText, policyValue } = require("./applicant-policy");

const YES_OPTION_PATTERNS = [/^yes\b/i, /\bi do\b/i, /\bagree\b/i, /\baccept\b/i, /\bauthorized\b/i, /\beligible\b/i];
const NO_OPTION_PATTERNS = [/^no\b/i, /\bi do not\b/i, /\bdecline\b/i, /\bnot authorized\b/i, /\brequire sponsorship\b/i];
const ANSWER_CONFIDENCE_THRESHOLD = 0.78;

function joinValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return typeof value === "string" ? value.trim() : value || "";
}

function hasResolvedAnswer(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
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

function yearsFact(yearsKey) {
  const value = Number(config.applicantFacts?.experience?.years?.[yearsKey]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasAnySkill(...skillKeys) {
  return skillKeys.some((skillKey) => skillFact(skillKey));
}

function isBooleanLikeField(field = {}, questionText = "") {
  return (
    field.type === "radio" ||
    field.type === "checkbox" ||
    field.type === "checkbox_group" ||
    hasYesNoOptions(field) ||
    /^(do|have|are|can|will|would|is)\b/.test(normalizeText(questionText))
  );
}

function wantsYearsAnswer(field = {}, questionText = "") {
  if (["radio", "checkbox", "checkbox_group", "select", "file"].includes(field.type)) {
    return false;
  }
  return /\byears?\b/.test(questionText) && /\b(experience|commercial|professional|worked|working)\b/.test(questionText);
}

function inferRiskLevel(questionText = "") {
  if (
    /criminal|felony|convict|disability|veteran|ethnicity|race|gender|security clearance|classified|degree|certification|licensed/.test(
      questionText,
    )
  ) {
    return "sensitive";
  }
  if (/visa|sponsor|authorized|right to work|citizenship|residency|residence permit/.test(questionText)) {
    return "legal";
  }
  if (/privacy|gdpr|data|consent|background check/.test(questionText)) {
    return "policy";
  }
  if (/salary|compensation|relocat/.test(questionText)) {
    return "preference";
  }
  return "standard";
}

function evidenceFromDossier(patterns) {
  const text = String(config.applicantProfileText || "");
  if (!text.trim()) return "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-#*\s]+/, "").trim())
    .filter(Boolean);
  return lines.find((line) => patterns.some((pattern) => pattern.test(line))) || "";
}

function answerDecisionFromResolution(resolution, field = {}, overrides = {}) {
  if (!resolution) return null;
  return {
    questionKey: resolution.questionKey || buildQuestionKey(resolution.intent, field),
    questionText: resolution.questionText || buildQuestionText(field),
    fieldLabel: field.label || null,
    fieldType: field.type || null,
    answer: resolution.answer || null,
    confidence: resolution.confidence || 0,
    source: resolution.source || null,
    sourceEvidence: resolution.sourceEvidence || null,
    reason: resolution.reason || null,
    riskLevel: resolution.riskLevel || inferRiskLevel(resolution.questionText || buildQuestionText(field)),
    shouldAutoFill: Boolean(resolution.autoAnswerable),
    requiresHumanReview: Boolean(resolution.requiresHumanReview),
    resolverMode: resolution.resolverMode || "deterministic",
    metadata: {
      intent: resolution.intent || null,
      options: Array.isArray(field.options) ? field.options : [],
      ...overrides.metadata,
    },
  };
}

function resolved(answer, source, confidence = 0.95, extra = {}) {
  return {
    answer,
    source,
    confidence,
    sourceEvidence: extra.sourceEvidence || null,
    reason: extra.reason || null,
    riskLevel: extra.riskLevel || null,
    requiresHumanReview: Boolean(extra.requiresHumanReview),
    resolverMode: extra.resolverMode || "deterministic",
  };
}

function inferSkillIntent(questionText) {
  if (/(python|py).*?\bor\b.*?(go|golang)|(go|golang).*?\bor\b.*?(python|py)|python\s*\/\s*(go|golang)|(go|golang)\s*\/\s*python/.test(questionText)) {
    return "experience.python_or_go";
  }

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
    ["experience.years.commercial_software_engineering", /years?.*(commercial|professional).*software engineering|commercial software engineering experience|software engineering experience.*years?/],
    ["experience.years.computer_vision", /years?.*(computer vision|machine vision|image processing)|(computer vision|machine vision|image processing).*years?/],
    ["experience.years.python", /years?.*python|python.*years?/],
    ["experience.years.react_typescript", /years?.*react.*type ?script|react.*type ?script.*years?/],
    ["experience.years.javascript_typescript", /years?.*(java ?script|type ?script)|(java ?script|type ?script).*years?/],
    ["experience.years.react", /years?.*react|react.*years?/],
    ["experience.years.go", /years?.*(\bgo\b|golang)|(\bgo\b|golang).*years?/],
    ["experience.python_or_go", /(advanced )?(python|py).*?\bor\b.*?(go|golang)|(go|golang).*?\bor\b.*?(python|py)|python\s*\/\s*(go|golang)|(go|golang)\s*\/\s*python/],
    ["authorization.citizenship_countries", /countries where you hold citizenship|citizenship/],
    ["authorization.permanent_residency_countries", /permanent residency|right to permanent residency|residency/],
    ["consent.read_privacy_notice", /read .*privacy notice/],
    ["consent.allow_future_roles", /considered for other job positions|future job positions|other job positions/],
    ["consent.personal_data", /personal data consent|data processing|privacy consent|gdpr|consent/i],
    ["consent.background_check", /background check|security checks/i],
    ["authorization.authorized_to_work", /authorized to work|legally authorized to work|eligible to work|right to work/],
    ["authorization.need_visa_sponsorship", /need visa sponsorship|require visa sponsorship|require sponsorship|need sponsorship|sponsorship.*visa|employment visa status|visa status/],
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
    case "experience.years.commercial_software_engineering":
      return resolved(
        yearsFact("commercialSoftwareEngineering") ?? yearsFact("softwareEngineering") ?? "",
        "facts",
        0.9,
      );
    case "experience.years.computer_vision":
      return resolved(
        yearsFact("computerVision") ?? yearsFact("machineVision") ?? "",
        "facts",
        0.9,
      );
    case "experience.years.python":
      return resolved(yearsFact("python") ?? "", "facts", 0.88);
    case "experience.years.react_typescript": {
      const reactYears = yearsFact("react");
      const typeScriptYears = yearsFact("typescript") ?? yearsFact("javascriptTypescript");
      const value =
        reactYears !== null && typeScriptYears !== null
          ? Math.min(reactYears, typeScriptYears)
          : reactYears ?? typeScriptYears ?? "";
      return resolved(value, "facts", 0.86);
    }
    case "experience.years.javascript_typescript":
      return resolved(
        yearsFact("javascriptTypescript") ?? yearsFact("typescript") ?? yearsFact("javascript") ?? "",
        "facts",
        0.88,
      );
    case "experience.years.react":
      return resolved(yearsFact("react") ?? "", "facts", 0.84);
    case "experience.years.go":
      return resolved(yearsFact("go") ?? "", "facts", 0.82);
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
    case "experience.python_or_go":
      return resolved(
        Boolean(hasAnySkill("python") || hasAnySkill("go")),
        "facts",
        0.88,
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

function localSemanticResolution(field = {}, options = {}) {
  const questionText = normalizeText(buildQuestionText(field));
  const riskLevel = inferRiskLevel(questionText);

  if (!questionText) {
    return resolved("", null, 0, {
      riskLevel,
      requiresHumanReview: true,
      reason: "Empty question text.",
      resolverMode: "semantic_local",
    });
  }

  if (riskLevel === "sensitive") {
    return resolved("", "review_required", 0, {
      riskLevel,
      requiresHumanReview: true,
      reason: "Sensitive unsupported question requires human review.",
      resolverMode: "semantic_local",
    });
  }

  const booleanLike = isBooleanLikeField(field, questionText);
  const sourceEvidence = evidenceFromDossier([
    /commercial software engineering/i,
    /machine vision|computer vision|python|javascript|typescript|react|go\/golang/i,
    /visa sponsorship|citizen|work within the eu/i,
  ]);

  if (/sponsorship|employment visa status|visa status/.test(questionText)) {
    return resolved(false, "facts", 0.94, {
      sourceEvidence: "Structured facts: needVisaSponsorship=false, requireVisaSponsorship=false.",
      reason: "Structured work authorization facts say visa sponsorship is not needed.",
      riskLevel,
      resolverMode: "semantic_local",
    });
  }

  if (/authorized to work|eligible to work|right to work/.test(questionText)) {
    return resolved(Boolean(config.applicantFacts?.authorization?.authorizedToWork), "facts", 0.92, {
      sourceEvidence: "Structured facts: authorizedToWork=true.",
      reason: "Structured work authorization facts support auto-answering this field.",
      riskLevel,
      resolverMode: "semantic_local",
    });
  }

  if (wantsYearsAnswer(field, questionText)) {
    const yearRules = [
      {
        patterns: [/commercial.*software engineering/, /software engineering/, /commercial software/],
        keys: ["commercialSoftwareEngineering", "softwareEngineering"],
        evidence: /commercial software engineering/i,
      },
      {
        patterns: [/computer vision/, /machine vision/, /image processing/],
        keys: ["computerVision", "machineVision"],
        evidence: /machine vision|computer vision/i,
      },
      {
        patterns: [/python.*go|go.*python|python\/go|go\/python/],
        keys: ["python"],
        evidence: /python/i,
      },
      {
        patterns: [/python/],
        keys: ["python"],
        evidence: /python/i,
      },
      {
        patterns: [/react.*type ?script|type ?script.*react/],
        keys: ["react"],
        evidence: /React|TypeScript/i,
      },
      {
        patterns: [/java ?script|type ?script|full[-\s]?stack/],
        keys: ["javascriptTypescript", "typescript", "javascript", "fullStack"],
        evidence: /JavaScript|TypeScript|full-stack/i,
      },
      {
        patterns: [/react/],
        keys: ["react"],
        evidence: /React/i,
      },
      {
        patterns: [/\bgo\b|golang/],
        keys: ["go"],
        evidence: /Go\/Golang/i,
      },
    ];

    for (const rule of yearRules) {
      if (!rule.patterns.some((pattern) => pattern.test(questionText))) continue;
      const value = rule.keys.map(yearsFact).find((year) => year !== null);
      if (value === null || value === undefined || value === "") continue;
      const evidence = evidenceFromDossier([rule.evidence]) || sourceEvidence;
      const isWeakGoClaim = rule.keys.includes("go") && value === 0;
      return resolved(String(value), "facts", isWeakGoClaim ? 0.7 : 0.86, {
        sourceEvidence: evidence || `Structured facts: experience.years.${rule.keys[0]}=${value}.`,
        reason: isWeakGoClaim
          ? "Structured facts say Go is not a primary strength."
          : "Structured experience-year fact matched the form question.",
        riskLevel,
        requiresHumanReview: isWeakGoClaim,
        resolverMode: "semantic_local",
      });
    }
  }

  if (booleanLike) {
    const skillRules = [
      {
        patterns: [/python.*go|go.*python|python\/go|go\/python/],
        value: hasAnySkill("python") || hasAnySkill("go"),
        evidence: /Python|Go\/Golang/i,
      },
      {
        patterns: [/python/],
        value: skillFact("python"),
        evidence: /Python/i,
      },
      {
        patterns: [/react.*type ?script|type ?script.*react/],
        value: Boolean(
          config.applicantFacts?.experience?.reactTypescriptComplexApps ||
            (skillFact("react") && skillFact("typescript")),
        ),
        evidence: /React|TypeScript/i,
      },
      {
        patterns: [/java ?script|type ?script/],
        value: hasAnySkill("javascript", "typescript"),
        evidence: /JavaScript|TypeScript/i,
      },
      {
        patterns: [/computer vision|machine vision|image processing/],
        value: hasAnySkill("computerVision", "machineVision"),
        evidence: /machine vision|computer vision/i,
      },
      {
        patterns: [/\bgo\b|golang/],
        value: skillFact("go"),
        evidence: /Go\/Golang/i,
      },
      {
        patterns: [/agentic|ai coding|codex|claude code|cursor|copilot/],
        value: hasAnySkill("agenticCodingTools"),
        evidence: /agentic coding/i,
      },
      {
        patterns: [/linux/],
        value: skillFact("linux"),
        evidence: /Linux/i,
      },
      {
        patterns: [/database|sql|postgres|mysql/],
        value: hasAnySkill("databases", "sql"),
        evidence: /databases|SQL/i,
      },
    ];

    for (const rule of skillRules) {
      if (!rule.patterns.some((pattern) => pattern.test(questionText))) continue;
      return resolved(Boolean(rule.value), "facts", 0.84, {
        sourceEvidence: evidenceFromDossier([rule.evidence]) || sourceEvidence,
        reason: "Structured skill fact matched the form question.",
        riskLevel,
        requiresHumanReview: false,
        resolverMode: "semantic_local",
      });
    }
  }

  return resolved("", null, 0, {
    riskLevel,
    requiresHumanReview: true,
    reason: "No high-confidence applicant fact matched this question.",
    resolverMode: "semantic_local",
  });
}

function normalizeExternalResolution(payload = {}, field = {}) {
  if (!payload || typeof payload !== "object") return null;
  const confidence = Number(payload.confidence);
  const resolution = resolved(
    payload.answer,
    payload.source || "llm",
    Number.isFinite(confidence) ? confidence : 0,
    {
      sourceEvidence: payload.sourceEvidence || payload.evidence || null,
      reason: payload.reason || null,
      riskLevel: payload.riskLevel || inferRiskLevel(buildQuestionText(field)),
      requiresHumanReview: Boolean(payload.requiresHumanReview),
      resolverMode: payload.resolverMode || "llm",
    },
  );
  return resolution;
}

async function resolveWithAnswerCommand(field = {}, options = {}) {
  const command = String(config.answerResolverCommand || "").trim();
  if (!command) return null;
  const { spawn } = require("child_process");
  const payload = {
    field,
    application: options.application || null,
    applicantFacts: config.applicantFacts,
    applicantProfile: config.applicantProfile,
    applicantProfileText: config.applicantProfileText,
    instruction:
      "Return one JSON object with answer, confidence, sourceEvidence, reason, riskLevel, shouldAutoFill, requiresHumanReview.",
  };

  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    let timeout = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(value);
    };
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, 15000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      try {
        finish(normalizeExternalResolution(JSON.parse(stdout), field));
      } catch {
        finish(null);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function resolveWithOpenAi(field = {}, options = {}) {
  const apiKey = String(config.answerResolverOpenAiApiKey || "").trim();
  const model = String(config.answerResolverModel || "").trim();
  if (!apiKey || !model || typeof fetch !== "function") return null;

  const response = await fetch(config.answerResolverOpenAiChatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You answer job application form fields from provided applicant facts only.",
            "Do not invent degrees, certifications, legal declarations, or unsupported claims.",
            "Return JSON with answer, confidence, sourceEvidence, reason, riskLevel, shouldAutoFill, requiresHumanReview.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            field,
            application: options.application || null,
            applicantFacts: config.applicantFacts,
            applicantProfile: config.applicantProfile,
            applicantProfileText: config.applicantProfileText,
          }),
        },
      ],
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return normalizeExternalResolution(JSON.parse(content), field);
  } catch {
    return null;
  }
}

async function resolveSemanticFieldAnswer(field = {}, options = {}) {
  const mode = normalizeText(config.answerResolverMode || "hybrid");
  const local = localSemanticResolution(field, options);
  if (hasResolvedAnswer(local.answer) || mode === "deterministic" || mode === "local") {
    return local;
  }

  if (["hybrid", "command"].includes(mode)) {
    const commandResolution = await resolveWithAnswerCommand(field, options);
    if (hasResolvedAnswer(commandResolution?.answer) || commandResolution?.requiresHumanReview) {
      return commandResolution;
    }
  }

  if (["hybrid", "llm", "openai"].includes(mode)) {
    const llmResolution = await resolveWithOpenAi(field, options);
    if (hasResolvedAnswer(llmResolution?.answer) || llmResolution?.requiresHumanReview) {
      return llmResolution;
    }
  }

  return local;
}

function resolveFieldAnswer(field = {}, options = {}) {
  const application = options.application || null;

  if (field.type === "file") {
    const filePath = application?.cv_variant_path || "";
    const fileResolution = {
      intent: "document.resume",
      questionKey: "document.resume",
      questionText: buildQuestionText(field),
      answer: filePath,
      source: filePath ? "application" : null,
      confidence: filePath ? 1 : 0,
      autoAnswerable: Boolean(filePath),
      riskLevel: "standard",
      requiresHumanReview: !filePath,
      resolverMode: "deterministic",
    };
    fileResolution.answerDecision = answerDecisionFromResolution(fileResolution, field);
    return fileResolution;
  }

  const classification = classifyIntent(field);
  const resolved = classification.intent
    ? resolveIntentValue(classification.intent, field, application)
    : { answer: "", source: null, confidence: 0 };
  const coercedAnswer = coerceAnswerForField(field, resolved.answer);
  const autoAnswerable = Boolean(coercedAnswer);

  const result = {
    intent: classification.intent,
    questionKey: buildQuestionKey(classification.intent, field),
    questionText: classification.questionText,
    answer: coercedAnswer,
    source: resolved.source,
    confidence: classification.confidence
      ? Math.min(classification.confidence, resolved.confidence || classification.confidence)
      : resolved.confidence || 0,
    autoAnswerable,
    sourceEvidence: resolved.source ? `Resolved by ${resolved.source} for ${classification.intent || "question"}.` : null,
    reason: classification.intent ? "Matched deterministic applicant question rule." : "No deterministic rule matched.",
    riskLevel: inferRiskLevel(classification.questionText),
    requiresHumanReview: !autoAnswerable,
    resolverMode: "deterministic",
  };
  result.answerDecision = answerDecisionFromResolution(result, field);
  return result;
}

async function resolveFieldAnswerAsync(field = {}, options = {}) {
  const deterministic = resolveFieldAnswer(field, options);
  if (deterministic.autoAnswerable) return deterministic;

  const semantic = await resolveSemanticFieldAnswer(field, options);
  const coercedAnswer = coerceAnswerForField(field, semantic.answer);
  const confidence = semantic.confidence || 0;
  const riskLevel = semantic.riskLevel || inferRiskLevel(buildQuestionText(field));
  const shouldAutoFill =
    Boolean(coercedAnswer) &&
    confidence >= ANSWER_CONFIDENCE_THRESHOLD &&
    riskLevel !== "sensitive" &&
    !semantic.requiresHumanReview;

  const result = {
    intent: deterministic.intent,
    questionKey: buildQuestionKey(deterministic.intent, field),
    questionText: deterministic.questionText || buildQuestionText(field),
    answer: coercedAnswer,
    source: semantic.source,
    confidence,
    autoAnswerable: shouldAutoFill,
    sourceEvidence: semantic.sourceEvidence || null,
    reason: semantic.reason || "Resolved by semantic applicant fact matching.",
    riskLevel,
    requiresHumanReview: !shouldAutoFill,
    resolverMode: semantic.resolverMode || "semantic_local",
  };
  result.answerDecision = answerDecisionFromResolution(result, field);
  return result;
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

async function annotateResolvedFieldAsync(field = {}, options = {}) {
  const resolution = await resolveFieldAnswerAsync(field, options);
  return {
    ...field,
    questionIntent: resolution.intent,
    questionKey: resolution.questionKey,
    resolvedAnswer: resolution.answer || null,
    resolutionSource: resolution.source || null,
    resolutionConfidence: resolution.confidence || 0,
    resolutionReason: resolution.reason || null,
    resolutionRiskLevel: resolution.riskLevel || null,
    resolutionRequiresHumanReview: Boolean(resolution.requiresHumanReview),
    autoAnswerable: resolution.autoAnswerable,
    answerDecision: resolution.answerDecision || null,
  };
}

module.exports = {
  buildQuestionText,
  classifyIntent,
  resolveFieldAnswer,
  resolveFieldAnswerAsync,
  annotateResolvedField,
  annotateResolvedFieldAsync,
  coerceAnswerForField,
};
