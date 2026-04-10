const fs = require("fs");
const path = require("path");
const {
  detectLinkedInLoginState,
  getPrimaryPage,
  gotoAndSettle,
  launchPersistentContext,
} = require("../../linkedin_search/lib/browser");
const { config } = require("./config");
const {
  ensureDir,
  slugify,
  stampForFile,
  isBrowserClosedError,
} = require("./utils");
const { FLOW_TYPE } = require("./state");

function classifyExternalUrl(targetUrl) {
  if (!targetUrl) return FLOW_TYPE.UNKNOWN;
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    if (hostname.includes("greenhouse.io"))
      return FLOW_TYPE.EXTERNAL_ATS_GREENHOUSE;
    if (hostname.includes("lever.co")) return FLOW_TYPE.EXTERNAL_ATS_LEVER;
    return FLOW_TYPE.EXTERNAL_CUSTOM;
  } catch {
    return FLOW_TYPE.UNKNOWN;
  }
}

async function inspectPrimaryApply(page) {
  return page.evaluate(() => {
    const normalize = (value) => value?.replace(/\s+/g, " ").trim() || null;
    const candidates = Array.from(document.querySelectorAll("button, a"))
      .map((node) => ({
        tagName: node.tagName.toLowerCase(),
        text: normalize(node.textContent || ""),
        href: node.getAttribute("href"),
        ariaLabel: node.getAttribute("aria-label"),
        className: node.className,
        visible: Boolean(
          node.offsetWidth || node.offsetHeight || node.getClientRects().length,
        ),
      }))
      .filter((item) =>
        /(easy apply|apply now|apply|continue applying)/i.test(
          `${item.text || ""} ${item.ariaLabel || ""}`,
        ),
      );

    return candidates.find((item) => item.visible) || candidates[0] || null;
  });
}

function decodeSerializedUrl(value) {
  if (!value) return null;
  return value
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, '"');
}

async function extractCompanyApplyUrl(page) {
  const html = await page.content();
  const match = html.match(/"companyApplyUrl":"([^"]+)"/);
  return match ? decodeSerializedUrl(match[1]) : null;
}

async function findVisibleApplyButton(page, pattern) {
  const buttons = page.locator(
    "button#jobs-apply-button-id, button[data-live-test-job-apply-button]",
  );
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    const text = await candidate.textContent().catch(() => "");
    const ariaLabel = await candidate
      .getAttribute("aria-label")
      .catch(() => "");
    const label = `${text || ""} ${ariaLabel || ""}`.trim();
    if (pattern.test(label)) {
      return candidate;
    }
  }

  return null;
}

async function extractEasyApplyState(page) {
  const modal = page
    .locator('.jobs-easy-apply-modal, div[role="dialog"]')
    .first();
  await modal.waitFor({ state: "visible", timeout: 15000 });

  return page.evaluate(() => {
    const dialog = document.querySelector(
      '.jobs-easy-apply-modal, div[role="dialog"]',
    );
    if (!dialog) return null;

    const fields = Array.from(
      dialog.querySelectorAll("input, textarea, select"),
    )
      .filter((field) => {
        const type = field.getAttribute("type");
        return type !== "hidden" && type !== "submit" && type !== "button";
      })
      .map((field) => {
        const label =
          field.closest("label")?.textContent ||
          dialog.querySelector(`label[for="${field.id}"]`)?.textContent ||
          field.getAttribute("aria-label") ||
          field.getAttribute("placeholder") ||
          field.getAttribute("name") ||
          field.id ||
          "field";
        const required =
          field.required ||
          field.getAttribute("aria-required") === "true" ||
          /\*/.test(label);
        const value = "value" in field ? String(field.value || "").trim() : "";
        return {
          name: field.getAttribute("name") || field.id || null,
          label: label.replace(/\s+/g, " ").trim(),
          type:
            field.tagName.toLowerCase() === "select"
              ? "select"
              : field.getAttribute("type") || field.tagName.toLowerCase(),
          required,
          valuePresent: value.length > 0,
        };
      });

    const buttons = Array.from(dialog.querySelectorAll("button"))
      .map((button) => button.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const emptyRequiredFields = fields.filter(
      (field) => field.required && !field.valuePresent,
    );
    return {
      fields,
      buttons,
      emptyRequiredFields,
    };
  });
}

function fieldSearchText(field) {
  return `${field?.label || ""} ${field?.name || ""}`
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePhoneValue(field, value) {
  const key = fieldSearchText(field);
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  if (/nationalnumber/.test(key) && normalized.startsWith("0")) {
    return normalized.replace(/^0+/, "");
  }

  return normalized;
}

function getApplicantAutofillValue(field) {
  const key = fieldSearchText(field);
  const profile = config.applicantProfile || {};

  if (/first name/.test(key)) return profile.firstName || "";
  if (/last name/.test(key)) return profile.lastName || "";
  if (/phone country code|nationality code|phone.*country/.test(key))
    return profile.phoneCountryCode || "";
  if (/mobile phone number|phone number|nationalnumber|phone/.test(key)) {
    return normalizePhoneValue(field, profile.phoneLocal || "");
  }
  if (/desired salary/.test(key)) return profile.desiredSalary || "";
  if (/email/.test(key)) return profile.email || "";
  if (/linkedin profile/.test(key)) return profile.linkedinProfileUrl || "";
  if (/countries where you hold citizenship/.test(key))
    return profile.citizenshipCountries || "";
  if (/countries where you hold a right to permanent residency/.test(key))
    return profile.permanentResidencyCountries || "";
  if (/location|city/.test(key)) return profile.city || "";
  if (/I have read and approved the Privacy Notice to Job Applicant/.test(key))
    return profile.policyRead || "YES";
  if (
    /I agree to be considered for other job positions and allow my information to be collected , processed and searchable in the Privacy Notice to Job Applicant/.test(
      key,
    )
  )
    return profile.policyAgree || "YES";
  return "";
}

function annotateEasyApplyFields(fields = []) {
  return fields.map((field) => {
    const autofillValue = getApplicantAutofillValue(field);
    return {
      ...field,
      autofillAvailable: Boolean(autofillValue),
    };
  });
}

function getUnfillableRequiredFields(fields = []) {
  return fields.filter(
    (field) =>
      field.required &&
      !field.valuePresent &&
      !getApplicantAutofillValue(field),
  );
}

function escapeForAttributeSelector(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFieldSelectors(field) {
  const selectors = [];
  const key = String(field?.name || "").trim();
  if (key) {
    const escaped = escapeForAttributeSelector(key);
    selectors.push(`[name="${escaped}"]`);
    selectors.push(`#${escaped}`);
  }
  return selectors.join(", ");
}

async function setEasyApplyFieldValue(page, field, value) {
  if (!field?.name || !value) return false;

  let locator = page
    .locator(
      buildFieldSelectors(field)
        .split(", ")
        .map(
          (selector) =>
            `.jobs-easy-apply-modal ${selector}, div[role="dialog"] ${selector}`,
        )
        .join(", "),
    )
    .first();

  if (!(await locator.count())) {
    const labelText = String(field.label || "")
      .replace(/\s+/g, " ")
      .trim();
    if (labelText) {
      locator = page
        .locator('.jobs-easy-apply-modal label, div[role="dialog"] label')
        .filter({ hasText: labelText })
        .locator(
          "xpath=following::input[1] | xpath=following::textarea[1] | xpath=following::select[1]",
        )
        .first();
    }
  }
  if (!(await locator.count())) return false;

  if (field.type === "select") {
    return locator
      .evaluate((element, desired) => {
        if (!element || element.tagName.toLowerCase() !== "select")
          return false;
        const options = Array.from(element.options || []);
        const normalizedDesired = String(desired).trim().toLowerCase();
        const match = options.find((option) => {
          const label = String(option.textContent || "")
            .trim()
            .toLowerCase();
          const valueText = String(option.value || "")
            .trim()
            .toLowerCase();
          return (
            label === normalizedDesired ||
            valueText === normalizedDesired ||
            label.includes(normalizedDesired) ||
            valueText.includes(normalizedDesired)
          );
        });
        if (!match) return false;
        element.value = match.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, value)
      .catch(() => false);
  }

  await locator.fill(String(value)).catch(() => {});
  if (/location|city/.test(fieldSearchText(field))) {
    await page.waitForTimeout(500);
    await locator.press("ArrowDown").catch(() => {});
    await locator.press("Enter").catch(() => {});
  }
  await locator.blur().catch(() => {});
  return true;
}

async function autofillEasyApplyFields(page, fields = []) {
  const filled = [];
  const skipped = [];

  for (const field of fields) {
    const value = getApplicantAutofillValue(field);
    if (!value) {
      skipped.push({
        name: field.name || null,
        label: field.label || null,
      });
      continue;
    }

    const ok = await setEasyApplyFieldValue(page, field, value);
    if (ok) {
      filled.push({
        name: field.name || null,
        label: field.label || null,
      });
    } else {
      skipped.push({
        name: field.name || null,
        label: field.label || null,
      });
    }
  }

  return { filled, skipped };
}

async function closeEasyApplyModal(page) {
  const closeButton = page
    .locator(
      '.jobs-easy-apply-modal button[aria-label*="Dismiss"], .jobs-easy-apply-modal button[aria-label*="Close"], div[role="dialog"] button[aria-label*="Dismiss"], div[role="dialog"] button[aria-label*="Close"]',
    )
    .first();
  if (await closeButton.count()) {
    await closeButton.click().catch(() => {});
    return;
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function savePageArtifacts(page, slug) {
  ensureDir(config.discoveryRoot);
  const stamp = stampForFile();
  const base = path.join(config.discoveryRoot, `${stamp}-${slugify(slug)}`);
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

async function discoverApplicationFlow(job, options = {}) {
  let context;
  let artifacts = null;
  try {
    context = await launchPersistentContext({
      headed: Boolean(options.headed),
    });
    const page = await getPrimaryPage(context);
    await gotoAndSettle(page, job.link);

    const loginState = await detectLinkedInLoginState(page);
    if (loginState !== "authenticated") {
      artifacts = await savePageArtifacts(
        page,
        `login-${job.jobId || job.title}`,
      );
      return {
        ok: false,
        loginState,
        readiness: "blocked",
        flowType: FLOW_TYPE.UNKNOWN,
        reason: `LinkedIn session is not ready (${loginState})`,
        fields: [],
        artifacts,
      };
    }

    const primaryApply = await inspectPrimaryApply(page);
    artifacts = await savePageArtifacts(page, job.jobId || job.title);

    if (!primaryApply) {
      return {
        ok: true,
        loginState,
        readiness: "blocked",
        flowType: FLOW_TYPE.NO_APPLY_PATH,
        reason: "No apply button found on the job page",
        fields: [],
        artifacts,
      };
    }

    const label =
      `${primaryApply.text || ""} ${primaryApply.ariaLabel || ""}`.trim();
    if (/easy apply|continue applying/i.test(label)) {
      const easyButton = await findVisibleApplyButton(
        page,
        /easy apply|continue applying/i,
      );
      if (!easyButton) {
        return {
          ok: true,
          loginState,
          readiness: "blocked",
          flowType: FLOW_TYPE.EASY_APPLY_NATIVE,
          reason: "Easy Apply button was detected but could not be activated",
          fields: [],
          artifacts,
        };
      }

      await easyButton.click();
      const state = await extractEasyApplyState(page);
      const annotatedFields = annotateEasyApplyFields(state?.fields || []);
      const unfillableRequiredFields =
        getUnfillableRequiredFields(annotatedFields);
      await closeEasyApplyModal(page);
      return {
        ok: true,
        loginState,
        readiness: unfillableRequiredFields.length
          ? "needs_human_input"
          : "ready_for_approval",
        flowType: FLOW_TYPE.EASY_APPLY_NATIVE,
        reason: unfillableRequiredFields.length
          ? `Easy Apply still needs manual answers: ${unfillableRequiredFields.map((field) => field.label).join(", ")}`
          : "Easy Apply required fields can be autofilled from the applicant profile",
        fields: annotatedFields,
        buttons: state?.buttons || [],
        artifacts,
      };
    }

    const externalUrl = primaryApply.href
      ? new URL(primaryApply.href, job.link).toString()
      : await extractCompanyApplyUrl(page);
    return {
      ok: true,
      loginState,
      readiness: "needs_human_input",
      flowType: classifyExternalUrl(externalUrl),
      reason:
        "External application flow discovered; manual review still required in v1",
      externalUrl,
      fields: [],
      artifacts,
    };
  } catch (error) {
    return {
      ok: false,
      loginState: "unknown",
      readiness: isBrowserClosedError(error) ? "recoverable_error" : "failed",
      flowType: FLOW_TYPE.UNKNOWN,
      reason: error.message,
      fields: [],
      artifacts,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function submitEasyApply(job, application, options = {}) {
  let context;
  let artifacts = null;
  try {
    context = await launchPersistentContext({
      headed: Boolean(options.headed),
    });
    const page = await getPrimaryPage(context);
    await gotoAndSettle(
      page,
      job.source_url || job.link || application.external_apply_url,
    );

    const loginState = await detectLinkedInLoginState(page);
    if (loginState !== "authenticated") {
      artifacts = await savePageArtifacts(
        page,
        `submit-login-${job.jobId || job.title}`,
      );
      return {
        ok: false,
        status: "failed",
        errorClass: "auth",
        reason: `LinkedIn session is not ready (${loginState})`,
        artifacts,
      };
    }

    const easyButton = await findVisibleApplyButton(
      page,
      /easy apply|continue applying/i,
    );
    if (!easyButton) {
      artifacts = await savePageArtifacts(
        page,
        `submit-missing-${job.jobId || job.title}`,
      );
      return {
        ok: false,
        status: "failed",
        errorClass: "flow",
        reason: "Easy Apply button not available at submission time",
        artifacts,
      };
    }

    await easyButton.click();
    for (let index = 0; index < 6; index += 1) {
      let state = await extractEasyApplyState(page);
      const fileInput = page
        .locator(
          '.jobs-easy-apply-modal input[type="file"], div[role="dialog"] input[type="file"]',
        )
        .first();
      if (application.cv_variant_path && (await fileInput.count())) {
        await fileInput
          .setInputFiles(application.cv_variant_path)
          .catch(() => {});
      }

      if (state?.emptyRequiredFields?.length) {
        await autofillEasyApplyFields(page, state.emptyRequiredFields || []);
        await page.waitForTimeout(800);
        state = await extractEasyApplyState(page);
      }

      if (state?.emptyRequiredFields?.length) {
        const annotatedFields = annotateEasyApplyFields(
          state.emptyRequiredFields || [],
        );
        artifacts = await savePageArtifacts(
          page,
          `submit-needs-human-${job.jobId || job.title}`,
        );
        await closeEasyApplyModal(page);
        return {
          ok: false,
          status: "needs_human_input",
          errorClass: "form",
          reason: "Application requires additional answers before submission",
          fields: annotatedFields,
          artifacts,
        };
      }

      const submitButton = page
        .locator('button:has-text("Submit application")')
        .first();
      if (await submitButton.count()) {
        await submitButton.click();
        await page.waitForTimeout(2500);
        artifacts = await savePageArtifacts(
          page,
          `submit-success-${job.jobId || job.title}`,
        );
        return {
          ok: true,
          status: "submitted",
          reason: "LinkedIn Easy Apply submitted",
          artifacts,
        };
      }

      const nextButton = page
        .locator('button:has-text("Next"), button:has-text("Review")')
        .first();
      if (await nextButton.count()) {
        await nextButton.click();
        await page.waitForTimeout(1500);
        continue;
      }

      artifacts = await savePageArtifacts(
        page,
        `submit-unknown-${job.jobId || job.title}`,
      );
      await closeEasyApplyModal(page);
      return {
        ok: false,
        status: "failed",
        errorClass: "flow",
        reason: "Could not find a supported next/review/submit button",
        artifacts,
      };
    }

    artifacts = await savePageArtifacts(
      page,
      `submit-timeout-${job.jobId || job.title}`,
    );
    await closeEasyApplyModal(page);
    return {
      ok: false,
      status: "failed",
      errorClass: "timeout",
      reason: "Exceeded maximum Easy Apply steps before submission",
      artifacts,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      errorClass: isBrowserClosedError(error) ? "browser_closed" : "exception",
      reason: error.message,
      artifacts,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = {
  discoverApplicationFlow,
  submitEasyApply,
};
