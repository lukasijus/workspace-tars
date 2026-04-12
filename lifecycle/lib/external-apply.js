const {
  getPrimaryPage,
  gotoAndSettle,
  launchPersistentContext,
} = require("../../linkedin_search/lib/browser");
const { config } = require("./config");
const {
  ensureDir,
  isBrowserClosedError,
  slugify,
  stampForFile,
} = require("./utils");
const { normalizeText } = require("./applicant-policy");
const {
  buildQuestionText,
  resolveFieldAnswerAsync,
  annotateResolvedFieldAsync,
} = require("./question-engine");
const { FLOW_TYPE } = require("./state");
const fs = require("fs");
const path = require("path");

const CLOSED_PATTERNS = [
  /no longer accepting applications/i,
  /applications closed/i,
  /job posting is no longer available/i,
  /position has been filled/i,
  /this role is no longer open/i,
  /this position is no longer available/i,
];

const SUCCESS_PATTERNS = [
  /thank you for applying/i,
  /application submitted/i,
  /successfully submitted/i,
  /we received your application/i,
  /your application has been submitted/i,
];

const HUMAN_CHECK_PATTERNS = [
  /session verification failed/i,
  /human check error/i,
  /please refresh the page, then resubmit your application/i,
  /captcha/i,
  /verify you are human/i,
  /security check/i,
];

const COOKIE_ACCEPT_PATTERNS = [
  "Accept",
  "Accept all",
  "I agree",
  "Agree",
  "Allow all",
];

function externalMaxSteps() {
  return (
    Number(config.applicantPolicy?.external?.maxSteps) ||
    Number(config.runTimeoutMinutes) ||
    8
  );
}

function externalMaxSameFingerprint() {
  return Number(config.applicantPolicy?.external?.maxSameFingerprint) || 2;
}

function detectHumanCheck(step) {
  const haystacks = [
    ...(Array.isArray(step?.validationErrors) ? step.validationErrors : []),
    step?.rawTextPreview || "",
  ].filter(Boolean);

  for (const text of haystacks) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    const matched = HUMAN_CHECK_PATTERNS.find((pattern) => pattern.test(normalized));
    if (matched) {
      return normalized;
    }
  }
  return null;
}

function ensureDiscoveryRoot() {
  ensureDir(config.discoveryRoot);
  return config.discoveryRoot;
}

async function saveExternalArtifacts(page, slug) {
  ensureDiscoveryRoot();
  const stamp = stampForFile();
  const base = path.join(
    config.discoveryRoot,
    `${stamp}-${slugify(slug || "external-application")}`,
  );
  const screenshotPath = `${base}.png`;
  const htmlPath = `${base}.html`;
  await page
    .screenshot({ path: screenshotPath, fullPage: true })
    .catch(() => {});
  const html = await page.content().catch(() => null);
  if (html) {
    fs.writeFileSync(htmlPath, html, "utf8");
  }
  return { screenshotPath, htmlPath };
}

async function acceptCookieBanners(page) {
  for (const label of COOKIE_ACCEPT_PATTERNS) {
    const locator = page
      .locator("button, a")
      .filter({ hasText: new RegExp(`^${label}$`, "i") })
      .first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click().catch(() => {});
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function activateApplySurface(page) {
  const anchors = [
    'a[href="#apply-form"]',
    'a[href*="#apply"]',
    "a:has-text('Apply')",
    "button:has-text('Apply')",
    "button:has-text('Start application')",
    "button:has-text('Continue')",
  ];

  for (const selector of anchors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click().catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }

  return false;
}

async function inspectExternalAvailability(page) {
  return page.evaluate((patterns) => {
    const bodyText = String(document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim();
    const reason = patterns.find((pattern) =>
      new RegExp(pattern, "i").test(bodyText),
    );
    if (!reason) {
      return {
        isActive: true,
        reason: null,
      };
    }
    return {
      isActive: false,
      reason,
    };
  }, CLOSED_PATTERNS.map((pattern) => pattern.source));
}

function inferProviderFromUrl(targetUrl, frameUrl) {
  const hostname = String(frameUrl || targetUrl || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "");

  if (hostname.includes("comeet")) return "comeet";
  if (hostname.includes("workable")) return "workable";
  if (hostname.includes("greenhouse")) return "greenhouse";
  if (hostname.includes("lever")) return "lever";
  return "custom_generic";
}

async function annotateExternalStepFields(step, application = null) {
  const annotatedFields = await Promise.all(
    (step.fields || []).map((field) =>
      annotateResolvedFieldAsync(field, { application }),
    ),
  );
  const requiredFields = annotatedFields.filter((field) => field.required);
  const unresolvedFields = requiredFields.filter(
    (field) => !field.valuePresent && !field.autoAnswerable,
  );

  return {
    ...step,
    fields: annotatedFields,
    requiredFields,
    unresolvedFields,
  };
}

async function extractStepFromContext(root, contextInfo = {}) {
  return root.evaluate(
    ({ closedPatterns, successPatterns, targetUrl, contextType, contextName }) => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();

      const lower = (value) => normalize(value).toLowerCase();
      const isVisible = (element) => {
        if (!element) return false;
        if (element.tagName?.toLowerCase() === "input") {
          const type = element.getAttribute("type");
          if (type === "hidden") return false;
          if (type === "file") return true;
        }
        return Boolean(
          element.offsetWidth || element.offsetHeight || element.getClientRects().length,
        );
      };

      const skipNode = (node) => {
        if (!node) return true;
        return Boolean(
          node.closest(
            '.cmplz-cookiebanner, .cmplz-manage-consent, [class*="cookie-banner"], [id*="cookie-banner"], [class*="cookieNotice"], [class*="cmplz"]',
          ),
        );
      };

      const bodyText = normalize(document.body?.innerText || "");
      const closedPattern = closedPatterns.find((pattern) =>
        new RegExp(pattern, "i").test(bodyText),
      );
      const successPattern = successPatterns.find((pattern) =>
        new RegExp(pattern, "i").test(bodyText),
      );

      const labelsById = new Map();
      Array.from(document.querySelectorAll("label[for]")).forEach((label) => {
        const key = label.getAttribute("for");
        if (!key) return;
        const text = normalize(label.textContent);
        if (text) labelsById.set(key, text);
      });

      const findLabel = (element) => {
        const direct =
          labelsById.get(element.id) ||
          normalize(element.getAttribute("aria-label")) ||
          normalize(element.closest("label")?.textContent) ||
          normalize(element.getAttribute("placeholder")) ||
          normalize(element.getAttribute("name")) ||
          normalize(element.id);
        if (direct) return direct;

        const container = element.closest(
          "fieldset, .field, .form-group, .formField, .comeet-form__field, .comeet-form__section, .input-group, li, p, div",
        );
        const containerText = normalize(container?.textContent || "");
        if (containerText) return containerText.slice(0, 160);
        return "field";
      };

      const buttons = Array.from(
        document.querySelectorAll(
          'button, input[type="submit"], input[type="button"], a[role="button"], a[href]',
        ),
      )
        .filter((node) => isVisible(node) && !skipNode(node))
        .map((node) => {
          const text =
            normalize(node.textContent) ||
            normalize(node.getAttribute("value")) ||
            normalize(node.getAttribute("aria-label"));
          if (!text) return null;
          const searchable = lower(`${text} ${node.getAttribute("href") || ""}`);
          let kind = "other";
          if (/submit|send application|apply now|finish application/i.test(searchable)) {
            kind = "submit";
          } else if (/review/i.test(searchable)) {
            kind = "review";
          } else if (/next|continue|save and continue|proceed/i.test(searchable)) {
            kind = "next";
          } else if (/apply|start/i.test(searchable)) {
            kind = "apply";
          }

          return {
            text,
            kind,
            href: node.getAttribute("href") || null,
            type: node.getAttribute("type") || node.tagName.toLowerCase(),
            disabled:
              Boolean(node.disabled) ||
              node.getAttribute("aria-disabled") === "true",
          };
        })
        .filter(Boolean);

      const fields = [];
      const handled = new Set();
      const radiosByName = new Map();
      const checkboxesByName = new Map();
      const inputNodes = Array.from(
        document.querySelectorAll("input, textarea, select"),
      ).filter((node) => !skipNode(node));

      for (const node of inputNodes) {
        const type = lower(node.getAttribute("type")) || node.tagName.toLowerCase();
        if (type === "hidden" || handled.has(node)) continue;

        if (type === "radio") {
          const name = node.getAttribute("name") || node.id || `radio-${radiosByName.size}`;
          if (!radiosByName.has(name)) radiosByName.set(name, []);
          radiosByName.get(name).push(node);
          handled.add(node);
          continue;
        }

        if (type === "checkbox") {
          const name = node.getAttribute("name") || node.id || `checkbox-${checkboxesByName.size}`;
          if (!checkboxesByName.has(name)) checkboxesByName.set(name, []);
          checkboxesByName.get(name).push(node);
          handled.add(node);
          continue;
        }

        const visible = isVisible(node) || type === "file";
        if (!visible) continue;
        const label = findLabel(node);
        const valuePresent =
          type === "file"
            ? Boolean(node.files && node.files.length)
            : normalize(node.value).length > 0;
        fields.push({
          kind: "field",
          type,
          name: node.getAttribute("name") || null,
          id: node.id || null,
          label,
          required:
            Boolean(node.required) ||
            node.getAttribute("aria-required") === "true" ||
            /\*/.test(label),
          valuePresent,
          options:
            node.tagName.toLowerCase() === "select"
              ? Array.from(node.options || []).map((option) => ({
                  label: normalize(option.textContent),
                  value: normalize(option.value),
                }))
              : [],
        });
      }

      for (const [name, nodes] of radiosByName.entries()) {
        const visibleNodes = nodes.filter((node) => isVisible(node));
        if (!visibleNodes.length) continue;
        const label =
          normalize(visibleNodes[0].closest("fieldset")?.querySelector("legend")?.textContent) ||
          findLabel(visibleNodes[0]);
        fields.push({
          kind: "field",
          type: "radio",
          name,
          id: visibleNodes[0].id || null,
          label,
          required:
            visibleNodes.some(
              (node) =>
                node.required || node.getAttribute("aria-required") === "true",
            ) || /\*/.test(label),
          valuePresent: visibleNodes.some((node) => Boolean(node.checked)),
          options: visibleNodes.map((node) => ({
            label: findLabel(node),
            value: normalize(node.getAttribute("value") || node.value),
            checked: Boolean(node.checked),
          })),
        });
      }

      for (const [name, nodes] of checkboxesByName.entries()) {
        const visibleNodes = nodes.filter((node) => isVisible(node));
        if (!visibleNodes.length) continue;
        const label =
          normalize(visibleNodes[0].closest("fieldset")?.querySelector("legend")?.textContent) ||
          findLabel(visibleNodes[0]);
        fields.push({
          kind: "field",
          type: visibleNodes.length > 1 ? "checkbox_group" : "checkbox",
          name,
          id: visibleNodes[0].id || null,
          label,
          required:
            visibleNodes.some(
              (node) =>
                node.required || node.getAttribute("aria-required") === "true",
            ) || /\*/.test(label),
          valuePresent: visibleNodes.some((node) => Boolean(node.checked)),
          options: visibleNodes.map((node) => ({
            label: findLabel(node),
            value: normalize(node.getAttribute("value") || node.value),
            checked: Boolean(node.checked),
          })),
        });
      }

      const validationErrors = Array.from(
        document.querySelectorAll(
          '[aria-invalid="true"], .error, .errors, .invalid, .field-error, .form-error, [role="alert"]',
        ),
      )
        .filter((node) => isVisible(node) && !skipNode(node))
        .map((node) => normalize(node.textContent))
        .filter(Boolean)
        .slice(0, 25);

      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const stepTitle =
        headings.find((text) => !/apply|job|careers?/i.test(text) || text.length < 100) ||
        headings[0] ||
        "Application step";

      const requiredFields = fields.filter((field) => field.required);
      const unresolvedFields = requiredFields.filter((field) => !field.valuePresent);
      const meaningfulFieldCount = fields.filter((field) => field.type !== "checkbox").length;

      return {
        contextType,
        contextName,
        url: location.href,
        pageTitle: document.title,
        stepTitle,
        success: Boolean(successPattern),
        successReason: successPattern || null,
        closed: Boolean(closedPattern),
        closedReason: closedPattern || null,
        fields,
        buttons,
        requiredFields,
        unresolvedFields,
        validationErrors,
        fieldCount: meaningfulFieldCount,
        buttonCount: buttons.length,
        rawTextPreview: bodyText.slice(0, 1200),
        providerHint: "custom_generic",
      };
    },
    {
      closedPatterns: CLOSED_PATTERNS.map((pattern) => pattern.source),
      successPatterns: SUCCESS_PATTERNS.map((pattern) => pattern.source),
      targetUrl: contextInfo.targetUrl || null,
      contextType: contextInfo.contextType || "page",
      contextName: contextInfo.contextName || "page",
    },
  );
}

async function collectContextCandidates(page, targetUrl, application = null) {
  const candidates = [];
  candidates.push({
    root: page,
    meta: {
      contextType: "page",
      contextName: "page",
    },
  });

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    candidates.push({
      root: frame,
      meta: {
        contextType: "frame",
        contextName: frame.url() || "frame",
      },
    });
  }

  const extracted = [];
  for (const candidate of candidates) {
    try {
      const step = await extractStepFromContext(candidate.root, {
        targetUrl,
        contextType: candidate.meta.contextType,
        contextName: candidate.meta.contextName,
      });
      const providerHint = inferProviderFromUrl(targetUrl, step.url);
      extracted.push({
        ...candidate,
        step: await annotateExternalStepFields(
          {
            ...step,
            providerHint,
          },
          application,
        ),
      });
    } catch {
      // Ignore inaccessible frames or transient extraction failures.
    }
  }

  extracted.sort((left, right) => {
    const leftScore =
      (left.step.fieldCount || 0) * 5 +
      (left.step.requiredFields?.length || 0) * 3 +
      (left.step.buttonCount || 0);
    const rightScore =
      (right.step.fieldCount || 0) * 5 +
      (right.step.requiredFields?.length || 0) * 3 +
      (right.step.buttonCount || 0);
    return rightScore - leftScore;
  });

  return extracted;
}

function buildStepFingerprint(step) {
  const required = (step.unresolvedFields || [])
    .map((field) => normalizeText(field.label || field.name || field.id))
    .filter(Boolean)
    .sort();
  const buttons = (step.buttons || [])
    .map((button) => `${button.kind}:${normalizeText(button.text)}`)
    .sort();
  return JSON.stringify({
    url: step.url,
    stepTitle: normalizeText(step.stepTitle),
    providerHint: step.providerHint,
    required,
    buttons,
  });
}

function externalPhoneValue(field) {
  const search = normalizeText(`${field.label} ${field.name} ${field.id}`);
  if (/country code/.test(search)) {
    return config.applicantProfile.phoneCountryCode || "";
  }

  const local = String(config.applicantProfile.phoneLocal || "").trim();
  if (!local) return "";
  if (/nationalnumber|local/i.test(search)) {
    return local.replace(/^0+/, "") || local;
  }
  return local;
}

async function resolveApplicantValue(field, application = {}) {
  const resolution = await resolveFieldAnswerAsync(field, { application });
  if (!resolution.autoAnswerable && field.type !== "file") return "";
  if (!resolution.answer) return "";
  if (/phone|mobile|telephone|nationalnumber/.test(normalizeText(buildQuestionText(field)))) {
    return externalPhoneValue({
      ...field,
      label: field.label,
      name: field.name,
      id: field.id,
    });
  }
  return resolution.answer;
}

function optionMatchesDesired(option, desired) {
  const wanted = normalizeText(desired);
  const label = normalizeText(option.label || option.value);
  if (!wanted || !label) return false;
  return (
    label === wanted ||
    label.includes(wanted) ||
    wanted.includes(label) ||
    (wanted === "yes" && /^y(es)?$/.test(label)) ||
    (wanted === "no" && /^no?$/.test(label))
  );
}

async function setFieldValue(root, field, desiredValue, application = {}) {
  if (!desiredValue && field.type !== "file") return false;

  const selectors = [];
  if (field.name) selectors.push(`[name="${String(field.name).replace(/"/g, '\\"')}"]`);
  if (field.id) selectors.push(`#${String(field.id).replace(/"/g, '\\"')}`);
  const selector = selectors.join(", ");

  if (field.type === "radio" || field.type === "checkbox" || field.type === "checkbox_group") {
    const desiredYes = /^(1|true|yes|on)$/i.test(String(desiredValue || "").trim());
    for (const option of field.options || []) {
      const matches =
        field.type === "checkbox_group"
          ? optionMatchesDesired(option, desiredValue)
          : optionMatchesDesired(option, desiredValue) ||
            (desiredYes &&
              (field.type === "checkbox" || field.type === "checkbox_group"));
      if (!matches) continue;

      const byLabel = root.getByLabel(option.label, { exact: false }).first();
      const count = await byLabel.count().catch(() => 0);
      if (count) {
        await byLabel.check({ force: true }).catch(async () => {
          await byLabel.click({ force: true }).catch(() => {});
        });
        return true;
      }
    }
    return false;
  }

  if (field.type === "select") {
    let locator = selector ? root.locator(selector).first() : null;
    if (!locator || !(await locator.count().catch(() => 0))) {
      locator = root.getByLabel(field.label, { exact: false }).first();
    }
    if (!(await locator.count().catch(() => 0))) return false;
    const ok = await locator
      .evaluate((element, desired) => {
        if (!element || element.tagName.toLowerCase() !== "select") return false;
        const options = Array.from(element.options || []);
        const wanted = String(desired || "").trim().toLowerCase();
        const match = options.find((option) => {
          const label = String(option.textContent || "").trim().toLowerCase();
          const value = String(option.value || "").trim().toLowerCase();
          const isYes =
            wanted === "yes" &&
            /(^yes\b|\bagree\b|\baccept\b|\beligible\b|\bauthorized\b)/i.test(label);
          const isNo =
            wanted === "no" &&
            /(^no\b|\bdecline\b|\bnot authorized\b|\brequire sponsorship\b)/i.test(label);
          return (
            label === wanted ||
            value === wanted ||
            label.includes(wanted) ||
            wanted.includes(label) ||
            value.includes(wanted) ||
            isYes ||
            isNo
          );
        });
        if (!match) return false;
        element.value = match.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, desiredValue)
      .catch(() => false);
    if (!ok) return false;
    return true;
  }

  if (field.type === "file") {
    let locator = selector ? root.locator(selector).first() : root.locator('input[type="file"]').first();
    if (!(await locator.count().catch(() => 0))) {
      locator = root.locator('input[type="file"]').first();
    }
    if (!(await locator.count().catch(() => 0))) return false;
    await locator.setInputFiles(application.cv_variant_path).catch(() => {});
    return true;
  }

  let locator = selector ? root.locator(selector).first() : null;
  if (!locator || !(await locator.count().catch(() => 0))) {
    locator = root.getByLabel(field.label, { exact: false }).first();
  }
  if (!(await locator.count().catch(() => 0)) && field.label) {
    locator = root
      .locator(
        "input, textarea, select",
      )
      .filter({ hasText: "" })
      .first();
  }
  if (!(await locator.count().catch(() => 0))) return false;

  await locator.fill(String(desiredValue)).catch(() => {});
  if (/city|location/.test(normalizeText(field.label))) {
    await root.waitForTimeout(400);
    await locator.press("ArrowDown").catch(() => {});
    await locator.press("Enter").catch(() => {});
  }
  await locator.blur().catch(() => {});
  return true;
}

function unresolvedFieldsForStep(step) {
  return (step.unresolvedFields || []).map((field) => ({
    name: field.name || null,
    id: field.id || null,
    label: field.label || null,
    type: field.type || null,
    options: field.options || [],
    questionIntent: field.questionIntent || null,
    questionKey: field.questionKey || null,
    resolvedAnswer: field.resolvedAnswer || null,
    resolutionSource: field.resolutionSource || null,
    resolutionConfidence: field.resolutionConfidence || 0,
    autoAnswerable: Boolean(field.autoAnswerable),
  }));
}

function selectPrimaryAction(step) {
  const preferredOrder = ["submit", "review", "next", "apply"];
  for (const kind of preferredOrder) {
    const match = (step.buttons || []).find(
      (button) => button.kind === kind && !button.disabled,
    );
    if (match) return match;
  }
  return null;
}

async function clickAction(root, action) {
  if (!action) return false;
  const byText = root
    .locator("button, input[type='submit'], input[type='button'], a[role='button'], a")
    .filter({ hasText: action.text })
    .first();
  const count = await byText.count().catch(() => 0);
  if (!count) return false;
  await byText.click({ force: true }).catch(() => {});
  return true;
}

async function prepareExternalPage(page) {
  await acceptCookieBanners(page).catch(() => {});
  await activateApplySurface(page).catch(() => {});
  await page.waitForTimeout(1200);
}

async function inspectExternalFlow(targetUrl, options = {}) {
  let context;
  let artifacts = null;

  try {
    context = await launchPersistentContext({
      headed: Boolean(options.headed),
    });
    const page = await getPrimaryPage(context);
    await gotoAndSettle(page, targetUrl);
    await prepareExternalPage(page);

    const availability = await inspectExternalAvailability(page);
    if (availability.isActive === false) {
      artifacts = await saveExternalArtifacts(page, `external-inactive-${targetUrl}`);
      return {
        ok: true,
        readiness: "blocked",
        flowType: FLOW_TYPE.NO_APPLY_PATH,
        reason: availability.reason,
        artifacts,
        jobActive: false,
        inactiveReason: availability.reason,
      };
    }

    const candidates = await collectContextCandidates(
      page,
      targetUrl,
      options.application || null,
    );
    const active = candidates[0];
    artifacts = await saveExternalArtifacts(page, `external-discovery-${targetUrl}`);

    if (!active) {
      return {
        ok: false,
        readiness: "failed",
        flowType: FLOW_TYPE.EXTERNAL_CUSTOM,
        reason: "No external application form was detected",
        artifacts,
        jobActive: true,
      };
    }

    const unresolved = unresolvedFieldsForStep(active.step).filter(
      (field) => !field.autoAnswerable,
    );
    const readiness = unresolved.length ? "needs_human_input" : "ready_for_approval";
    const reason = unresolved.length
      ? `External application needs more answers: ${unresolved
          .map((field) => field.label)
          .filter(Boolean)
          .join(", ")}`
      : "External application fields can be completed from the applicant profile and policy";

    return {
      ok: true,
      readiness,
      flowType: FLOW_TYPE.EXTERNAL_CUSTOM,
      reason,
      externalUrl: targetUrl,
      fields: active.step.fields,
      discoveredFields: active.step,
      unresolvedFields: unresolved,
      artifacts,
      jobActive: true,
    };
  } catch (error) {
    return {
      ok: false,
      readiness: isBrowserClosedError(error) ? "recoverable_error" : "failed",
      flowType: FLOW_TYPE.EXTERNAL_CUSTOM,
      reason: error.message,
      artifacts,
      jobActive: true,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function submitExternalCustom(job, application, options = {}) {
  let context;
  let artifacts = null;

  try {
    context = await launchPersistentContext({
      headed: Boolean(options.headed),
    });
    const page = await getPrimaryPage(context);
    const targetUrl =
      application.external_apply_url || job.external_apply_url || job.source_url;
    await gotoAndSettle(page, targetUrl);

    const seenFingerprints = new Map();

    for (let attempt = 0; attempt < externalMaxSteps(); attempt += 1) {
      await prepareExternalPage(page);
      const availability = await inspectExternalAvailability(page);
      if (availability.isActive === false) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-inactive-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "skipped",
          errorClass: "inactive",
          reason: availability.reason,
          artifacts,
          jobActive: false,
          inactiveReason: availability.reason,
        };
      }

      const candidates = await collectContextCandidates(page, targetUrl, application);
      const active = candidates[0];
      if (!active) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-missing-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "flow",
          reason: "No external application form was detected",
          artifacts,
          jobActive: true,
          fields: [],
        };
      }

      const activeHumanCheck = detectHumanCheck(active.step);
      if (activeHumanCheck) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-human-check-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "human_check",
          reason: activeHumanCheck,
          artifacts,
          jobActive: true,
          fields: unresolvedFieldsForStep(active.step),
          step: active.step,
        };
      }

      const fingerprint = buildStepFingerprint(active.step);
      const seen = (seenFingerprints.get(fingerprint) || 0) + 1;
      seenFingerprints.set(fingerprint, seen);
      if (seen >= externalMaxSameFingerprint()) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-loop-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "loop",
          reason: "External application looped on the same step",
          artifacts,
          jobActive: true,
          fields: unresolvedFieldsForStep(active.step),
          step: active.step,
        };
      }

      if (active.step.closed) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-closed-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "skipped",
          errorClass: "inactive",
          reason: active.step.closedReason,
          artifacts,
          jobActive: false,
          inactiveReason: active.step.closedReason,
        };
      }

      if (active.step.success) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-success-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: true,
          status: "submitted",
          reason: active.step.successReason || "External application submitted",
          artifacts,
          jobActive: true,
          step: active.step,
        };
      }

      const fields = active.step.fields || [];
      const unresolved = [];
      for (const field of fields) {
        if (!field.required || field.valuePresent) continue;
        const desiredValue = field.autoAnswerable
          ? field.resolvedAnswer || await resolveApplicantValue(field, application)
          : "";
        if (!field.autoAnswerable && !desiredValue && field.type !== "file") {
          unresolved.push(field);
          continue;
        }

        const ok = await setFieldValue(active.root, field, desiredValue, application);
        if (!ok) {
          unresolved.push(field);
        }
      }

      await page.waitForTimeout(1200);
      const refreshedCandidates = await collectContextCandidates(
        page,
        targetUrl,
        application,
      );
      const refreshed = refreshedCandidates[0] || active;
      const refreshedHumanCheck = detectHumanCheck(refreshed.step);
      if (refreshedHumanCheck) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-human-check-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "human_check",
          reason: refreshedHumanCheck,
          artifacts,
          jobActive: true,
          fields: unresolvedFieldsForStep(refreshed.step),
          step: refreshed.step,
        };
      }
      const refreshedUnresolved = unresolvedFieldsForStep(refreshed.step).filter(
        (field) => !field.autoAnswerable,
      );

      if (refreshed.step.success) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-success-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: true,
          status: "submitted",
          reason: refreshed.step.successReason || "External application submitted",
          artifacts,
          jobActive: true,
          step: refreshed.step,
        };
      }

      if (refreshedUnresolved.length) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-needs-human-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "form",
          reason: "External application requires additional answers before submission",
          fields: refreshedUnresolved,
          artifacts,
          jobActive: true,
          step: refreshed.step,
        };
      }

      const action = selectPrimaryAction(refreshed.step);
      if (!action) {
        artifacts = await saveExternalArtifacts(
          page,
          `external-submit-no-action-${job.title || job.jobId || application.id}`,
        );
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "flow",
          reason: "Could not determine the next external application action",
          fields: unresolvedFieldsForStep(refreshed.step),
          artifacts,
          jobActive: true,
          step: refreshed.step,
        };
      }

      await clickAction(active.root, action);
      await page.waitForTimeout(action.kind === "submit" ? 2500 : 1400);
    }

    artifacts = await saveExternalArtifacts(
      page,
      `external-submit-timeout-${job.title || job.jobId || application.id}`,
    );
    return {
      ok: false,
      status: "failed",
      errorClass: "timeout",
      reason: "Exceeded maximum external application steps before submission",
      artifacts,
      jobActive: true,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      errorClass: isBrowserClosedError(error) ? "browser_closed" : "exception",
      reason: error.message,
      artifacts,
      jobActive: true,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = {
  inspectExternalFlow,
  submitExternalCustom,
  resolveApplicantValue,
};
