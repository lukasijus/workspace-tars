const { spawn } = require("child_process");
const { config } = require("./config");

const CATEGORY_DEFINITIONS = {
  hardSkills: [
    ["Python", /\bpython\b/i],
    ["JavaScript", /\bjavascript\b|\bjs\b/i],
    ["TypeScript", /\btypescript\b|\bts\b/i],
    ["SQL", /\bsql\b/i],
    ["C/C++", /\bc\+\+\b|\bc\b(?=[\s,./)-])/i],
    ["Go", /\bgolang\b|\bgo\b/i],
    ["Java", /\bjava\b/i],
    ["MATLAB", /\bmatlab\b/i],
  ],
  frameworks: [
    ["React", /\breact(?:\.js)?\b/i],
    ["Vue", /\bvue(?:\.js)?\b/i],
    ["Node.js", /\bnode(?:\.js)?\b/i],
    ["FastAPI", /\bfastapi\b/i],
    ["Django", /\bdjango\b/i],
    ["Flask", /\bflask\b/i],
    ["SQLAlchemy", /\bsqlalchemy\b/i],
    ["Vuetify", /\bvuetify\b/i],
    ["Next.js", /\bnext(?:\.js)?\b/i],
    ["Express", /\bexpress(?:\.js)?\b/i],
  ],
  tools: [
    ["Linux", /\blinux\b/i],
    ["Docker", /\bdocker\b/i],
    ["AWS", /\baws\b|\bamazon web services\b/i],
    ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
    ["MySQL", /\bmysql\b/i],
    ["Git", /\bgit\b|\bgithub\b|\bgitlab\b/i],
    ["CI/CD", /\bci\/cd\b|\bcontinuous integration\b|\bdeployment pipeline/i],
    ["REST APIs", /\brest(?:ful)?\b|\bapi(?:s)?\b/i],
    ["GraphQL", /\bgraphql\b/i],
    ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
    ["OPC UA", /\bopc\s*ua\b/i],
    ["Beckhoff PLCs", /\bbeckhoff\b|\bplc(?:s)?\b/i],
    ["Playwright", /\bplaywright\b/i],
  ],
  domains: [
    ["Full-stack engineering", /\bfull[-\s]?stack\b/i],
    ["Backend engineering", /\bbackend\b|\bback-end\b/i],
    ["Frontend engineering", /\bfrontend\b|\bfront-end\b/i],
    ["Platform engineering", /\bplatform engineer|\bplatform engineering|\bplatform\b/i],
    ["Applied AI", /\bapplied ai\b|\bai\b|\bartificial intelligence\b/i],
    ["Machine learning", /\bmachine learning\b|\bml\b/i],
    ["Agentic automation", /\bagentic\b|\bagents?\b|\bllm\b|\brag\b/i],
    ["Computer vision", /\bcomputer vision\b|\bmachine vision\b|\bimage processing\b/i],
    ["Industrial automation", /\bindustrial\b|\bautomation\b|\bmanufacturing\b/i],
    ["Data engineering", /\bdata engineering\b|\bdata pipeline/i],
    ["SaaS", /\bsaas\b/i],
  ],
  responsibilities: [
    ["Build product features", /\bbuild\b|\bdevelop\b|\bship\b|\bdeliver\b/i],
    ["Design APIs", /\bapi design\b|\bdesign.*api|\brest\b|\bgraphql\b/i],
    ["Own end-to-end delivery", /\bend[-\s]?to[-\s]?end\b|\bownership\b|\bown\b/i],
    ["Improve reliability", /\breliab(?:le|ility)\b|\buptime\b|\bincident\b|\bdebug\b/i],
    ["Scale systems", /\bscale\b|\bscalable\b|\bperformance\b|\blatency\b|\bthroughput\b/i],
    ["Automate workflows", /\bautomat(?:e|ion|ed)\b|\bworkflow\b|\bpipeline\b/i],
    ["Collaborate cross-functionally", /\bcollaborat\b|\bcross[-\s]?functional\b|\bstakeholder\b/i],
  ],
  softSkills: [
    ["Communication", /\bcommunication\b|\bcommunicate\b/i],
    ["Mentoring", /\bmentor\b|\bcoach\b|\bleadership\b/i],
    ["Ownership", /\bownership\b|\baccountable\b|\bself[-\s]?directed\b/i],
    ["Product mindset", /\bproduct mindset\b|\buser\b|\bcustomer\b/i],
    ["Problem solving", /\bproblem[-\s]?solving\b|\btroubleshoot\b|\bdebug\b/i],
  ],
  senioritySignals: [
    ["Senior", /\bsenior\b|\bsr\.\b/i],
    ["Staff", /\bstaff\b/i],
    ["Lead", /\blead\b|\bprincipal\b/i],
    ["Architecture", /\barchitect(?:ure|ing)?\b|\bsystem design\b/i],
    ["Technical leadership", /\btechnical leadership\b|\btech lead\b/i],
  ],
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function matchCategory(text, definitions) {
  const matched = [];
  for (const [label, pattern] of definitions) {
    if (pattern.test(text)) matched.push(label);
  }
  return matched;
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

function pickSentences(text, patterns, limit = 8) {
  const sentences = splitSentences(text);
  const picked = [];
  for (const sentence of sentences) {
    if (patterns.some((pattern) => pattern.test(sentence))) {
      picked.push(sentence);
    }
    if (picked.length >= limit) break;
  }
  return picked;
}

function buildAtsKeywords(extraction) {
  return unique([
    ...extraction.hardSkills,
    ...extraction.frameworks,
    ...extraction.tools,
    ...extraction.domains,
    ...extraction.responsibilities,
  ]).slice(0, 32);
}

function buildHeadlineHints(job, extraction) {
  const hints = [];
  const title = String(job.title || "");
  const domains = new Set(extraction.domains);

  if (/full[-\s]?stack/i.test(title) || domains.has("Full-stack engineering")) {
    hints.push("Senior Full-Stack Engineer");
  }
  if (/backend|platform/i.test(title) || domains.has("Backend engineering") || domains.has("Platform engineering")) {
    hints.push("Backend / Platform Engineer");
  }
  if (/ai|agent|llm|ml/i.test(title) || domains.has("Applied AI") || domains.has("Agentic automation")) {
    hints.push("Applied AI / Agentic Automation");
  }
  if (/vision|image|industrial|automation/i.test(title) || domains.has("Computer vision") || domains.has("Industrial automation")) {
    hints.push("Industrial Computer Vision / Automation");
  }

  return unique(hints).slice(0, 4);
}

function deterministicExtract(job) {
  const description = normalizeText(job.descriptionText || "");
  const haystack = normalizeText([
    job.title,
    job.company,
    job.location,
    job.searchName,
    description,
  ].filter(Boolean).join("\n"));

  const extraction = {
    source: "deterministic",
    hardSkills: matchCategory(haystack, CATEGORY_DEFINITIONS.hardSkills),
    frameworks: matchCategory(haystack, CATEGORY_DEFINITIONS.frameworks),
    tools: matchCategory(haystack, CATEGORY_DEFINITIONS.tools),
    domains: matchCategory(haystack, CATEGORY_DEFINITIONS.domains),
    responsibilities: matchCategory(haystack, CATEGORY_DEFINITIONS.responsibilities),
    softSkills: matchCategory(haystack, CATEGORY_DEFINITIONS.softSkills),
    senioritySignals: matchCategory(haystack, CATEGORY_DEFINITIONS.senioritySignals),
    mustHave: pickSentences(description, [
      /\brequired\b/i,
      /\bmust\b/i,
      /\byou have\b/i,
      /\bexperience with\b/i,
      /\bproficient\b/i,
      /\bstrong\b/i,
    ]),
    niceToHave: pickSentences(description, [
      /\bnice to have\b/i,
      /\bbonus\b/i,
      /\bpreferred\b/i,
      /\bplus\b/i,
    ]),
    missingOrWeakSignals: [],
    matchedCandidateStrengths: [],
    cvHeadlineHints: [],
    atsKeywords: [],
  };

  extraction.atsKeywords = buildAtsKeywords(extraction);
  extraction.cvHeadlineHints = buildHeadlineHints(job, extraction);
  extraction.matchedCandidateStrengths = unique([
    ...extraction.hardSkills.filter((skill) => ["Python", "JavaScript", "TypeScript", "SQL", "C/C++"].includes(skill)),
    ...extraction.frameworks.filter((skill) => ["React", "Vue", "FastAPI", "SQLAlchemy", "Vuetify"].includes(skill)),
    ...extraction.tools.filter((skill) => ["Linux", "Docker", "AWS", "MySQL", "PostgreSQL", "REST APIs", "OPC UA", "Beckhoff PLCs"].includes(skill)),
    ...extraction.domains.filter((skill) => ["Applied AI", "Agentic automation", "Computer vision", "Industrial automation", "Full-stack engineering", "Backend engineering", "Platform engineering"].includes(skill)),
  ]);

  return extraction;
}

function coerceArray(value) {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => String(item || "")));
}

function normalizeExternalExtraction(payload) {
  const normalized = {};
  for (const key of [
    "hardSkills",
    "frameworks",
    "tools",
    "domains",
    "responsibilities",
    "softSkills",
    "senioritySignals",
    "mustHave",
    "niceToHave",
    "atsKeywords",
    "cvHeadlineHints",
    "matchedCandidateStrengths",
    "missingOrWeakSignals",
  ]) {
    normalized[key] = coerceArray(payload?.[key]);
  }
  normalized.source = String(payload?.source || "llm");
  return normalized;
}

function mergeExtractions(base, extra) {
  if (!extra) return base;
  const merged = {
    ...base,
    source: base.source === "deterministic" ? "hybrid" : base.source,
  };

  for (const key of [
    "hardSkills",
    "frameworks",
    "tools",
    "domains",
    "responsibilities",
    "softSkills",
    "senioritySignals",
    "mustHave",
    "niceToHave",
    "atsKeywords",
    "cvHeadlineHints",
    "matchedCandidateStrengths",
    "missingOrWeakSignals",
  ]) {
    merged[key] = unique([...(base[key] || []), ...(extra[key] || [])]);
  }

  merged.atsKeywords = buildAtsKeywords(merged);
  return merged;
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Extractor returned empty output");
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new Error("Extractor output was not valid JSON");
  }
}

function runCommandExtractor(input, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Keyword extractor command failed with exit ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(parseJsonFromText(stdout));
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

async function runOpenAiExtractor(input) {
  if (!config.keywordExtractorModel || !config.keywordExtractorOpenAiApiKey) {
    return null;
  }

  const response = await fetch(config.keywordExtractorOpenAiChatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.keywordExtractorOpenAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.keywordExtractorModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Extract software job skills for truthful CV tailoring.",
            "Return only JSON with arrays for hardSkills, frameworks, tools, domains, responsibilities, softSkills, senioritySignals, mustHave, niceToHave, atsKeywords, cvHeadlineHints, matchedCandidateStrengths, and missingOrWeakSignals.",
            "Do not invent candidate experience; matchedCandidateStrengths must be limited to skills that are plausible from the provided candidate profile facts.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI extractor failed with HTTP ${response.status}`);
  }

  return parseJsonFromText(payload?.choices?.[0]?.message?.content || "");
}

async function extractJobKeywords(job, options = {}) {
  const mode = String(options.mode || config.keywordExtractorMode || "hybrid").toLowerCase();
  const extractedAt = new Date().toISOString();
  const deterministic = deterministicExtract(job);
  const hasDescription = Boolean(normalizeText(job.descriptionText || ""));

  const input = {
    job: {
      title: job.title || null,
      company: job.company || null,
      location: job.location || null,
      searchName: job.searchName || null,
      descriptionText: job.descriptionText || null,
    },
    candidateProfile: {
      focus: [
        "JavaScript/TypeScript",
        "Python",
        "Linux",
        "databases",
        "computer vision",
        "industrial automation",
        "agentic coding",
        "backend-heavy full-stack",
      ],
    },
    deterministicExtraction: deterministic,
  };

  if (mode === "deterministic" || (!config.keywordExtractorCommand && !config.keywordExtractorModel)) {
    return {
      status: hasDescription ? "deterministic" : "title_only",
      extractedAt,
      extraction: {
        ...deterministic,
        metadata: {
          hasDescription,
          mode: "deterministic",
        },
      },
    };
  }

  try {
    const externalPayload = config.keywordExtractorCommand
      ? await runCommandExtractor(input, config.keywordExtractorCommand)
      : await runOpenAiExtractor(input);

    if (!externalPayload) {
      return {
        status: hasDescription ? "deterministic" : "title_only",
        extractedAt,
        extraction: {
          ...deterministic,
          metadata: {
            hasDescription,
            mode,
            fallbackReason: "llm_not_configured",
          },
        },
      };
    }

    const external = normalizeExternalExtraction(externalPayload);
    return {
      status: mode === "llm" ? "llm" : "hybrid",
      extractedAt,
      extraction: {
        ...mergeExtractions(deterministic, external),
        metadata: {
          hasDescription,
          mode,
          externalSource: external.source,
        },
      },
    };
  } catch (error) {
    return {
      status: "fallback",
      extractedAt,
      extraction: {
        ...deterministic,
        metadata: {
          hasDescription,
          mode,
          fallbackReason: error.message,
        },
      },
    };
  }
}

module.exports = {
  deterministicExtract,
  extractJobKeywords,
};
