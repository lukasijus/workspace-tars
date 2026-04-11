function isDecisionLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.questionKey || value.questionText) &&
      Object.prototype.hasOwnProperty.call(value, "shouldAutoFill"),
  );
}

function collectAnswerDecisions(input, options = {}) {
  const maxDepth = Number(options.maxDepth) || 8;
  const seen = new WeakSet();
  const decisions = [];

  function visit(value, depth) {
    if (!value || typeof value !== "object" || depth > maxDepth) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (isDecisionLike(value.answerDecision)) {
      decisions.push(value.answerDecision);
    }

    if (isDecisionLike(value)) {
      decisions.push(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    for (const child of Object.values(value)) {
      visit(child, depth + 1);
    }
  }

  visit(input, 0);

  const dedupe = new Set();
  return decisions.filter((decision) => {
    const key = [
      decision.questionKey || "",
      decision.questionText || "",
      decision.answer || "",
      decision.resolverMode || "",
    ].join("\u0000");
    if (dedupe.has(key)) return false;
    dedupe.add(key);
    return true;
  });
}

module.exports = {
  collectAnswerDecisions,
};
