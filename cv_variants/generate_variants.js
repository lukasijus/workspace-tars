#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CV_REPO_DIR = process.env.TARS_CV_REPO_DIR || path.join(process.env.HOME || '/home/user', 'cv');
const CV_MAIN_TEX = process.env.TARS_CV_MAIN_TEX || 'cv.tex';
const BASE_CV = path.join(CV_REPO_DIR, CV_MAIN_TEX);
const DEFAULT_INPUT = `${ROOT}/linkedin_search/output/latest_jobs.json`;
const OUTPUT_ROOT = `${ROOT}/cv_variants/output`;
const LATEST_MANIFEST = `${OUTPUT_ROOT}/latest_manifest.json`;
const DEFAULT_LIMIT = 5;
const CANDIDATE_DISPLAY_NAME = String(
  process.env.TARS_CANDIDATE_DISPLAY_NAME || 'Candidate Name',
).trim();
const NAME_PREFIX = sanitizeSegment(process.env.TARS_CANDIDATE_FILENAME_PREFIX || 'CANDIDATE', 60);

function usage() {
  return `Usage: node generate_variants.js [--input PATH] [--output-dir DIR] [--limit N] [--job-index N] [--quiet]

Generate tailored LaTeX CV variants from a LinkedIn results JSON file.

Examples:
  node generate_variants.js --limit 5
  node generate_variants.js --job-index 0
  node generate_variants.js --input /path/to/jobs.json --output-dir /tmp/cv-variants
`;
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    outputDir: null,
    limit: DEFAULT_LIMIT,
    jobIndex: null,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.input = argv[++index];
    } else if (arg === '--output-dir') {
      args.outputDir = argv[++index];
    } else if (arg === '--limit') {
      args.limit = Number(argv[++index]);
    } else if (arg === '--job-index') {
      args.jobIndex = Number(argv[++index]);
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  if (args.jobIndex !== null && (!Number.isInteger(args.jobIndex) || args.jobIndex < 0)) {
    throw new Error('--job-index must be a non-negative integer');
  }

  return args;
}

function log(message, args) {
  if (!args.quiet) {
    process.stderr.write(`[cv-variants] ${message}\n`);
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function chooseCompiler() {
  for (const compiler of ['latexmk', 'pdflatex']) {
    const result = spawnSync('bash', ['-lc', `command -v ${compiler}`], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      return compiler;
    }
  }
  throw new Error('No supported LaTeX compiler available (need latexmk or pdflatex)');
}

function sanitizeSegment(value, maxLength = 40) {
  return String(value || 'UNKNOWN')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase()
    .slice(0, maxLength) || 'UNKNOWN';
}

function buildStem(job, usedStems) {
  const base = [
    NAME_PREFIX,
    sanitizeSegment(job.company, 28),
    sanitizeSegment(job.title, 42),
  ].join('_');

  let stem = base;
  let counter = 1;
  while (usedStems.has(stem)) {
    const suffix = sanitizeSegment(job.location || job.jobId || `${counter}`, 18);
    stem = `${base}_${suffix || counter}`;
    counter += 1;
  }
  usedStems.add(stem);
  return stem;
}

function chooseTrack(job) {
  const primary = [
    job.title,
    job.searchName,
    ...(job.keywordExtraction?.atsKeywords || []),
    ...(job.keywordExtraction?.cvHeadlineHints || []),
  ].filter(Boolean).join(' ').toLowerCase();
  const secondary = [
    job.company,
    job.location,
    job.descriptionText,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(computer vision|machine vision|vision systems|vision engineer|ocr|inspection)/.test(primary)) {
    return 'vision';
  }
  if (/(platform|architect|data platform|backend|node\.?js|aws|data engineer|infrastructure)/.test(primary)) {
    return 'platform';
  }
  if (/(llm|rag|gen ai|agentic|automation engineer|ai\/ml|artificial intelligence|python.+ai|ai\b|ml\b)/.test(primary)) {
    return 'ai_automation';
  }
  if (/(full stack|fullstack|frontend|software engineer)/.test(primary)) {
    return 'fullstack';
  }
  if (/(computer vision|machine vision|ocr|inspection)/.test(secondary)) {
    return 'vision';
  }
  if (/(platform|architect|data platform|backend|node\.?js|aws|data engineer|infrastructure)/.test(secondary)) {
    return 'platform';
  }
  if (/(llm|rag|gen ai|agentic|automation engineer|ai\/ml|artificial intelligence|python.+ai|ai\b|ml\b)/.test(secondary)) {
    return 'ai_automation';
  }
  return 'general';
}

const TRACK_CONTENT = {
  general: {
    summary:
      'Senior full-stack / software engineer with 10+ years of experience building Linux-based production software, industrial computer-vision systems, and web products. Strong across Python, JavaScript/TypeScript, SQL, and modern frontend/backend stacks, with recent work spanning Vue/Vuetify, SQLAlchemy/MySQL, FastAPI, React/TypeScript, Docker, and AWS. Best fit: backend-heavy full-stack, platform, automation, and AI-adjacent roles where reliable systems and product delivery matter.',
    skills: [
      '\\textbf{Languages:} Python, JavaScript/TypeScript, SQL, C/C++, MATLAB \\\\',
      '\\textbf{Backend and Data:} FastAPI, SQLAlchemy, MySQL, REST APIs, relational data modeling \\\\',
      '\\textbf{Frontend and Infra:} React, Vue, Vuetify, Linux, Git, Docker, AWS \\\\',
      '\\textbf{Vision, Automation, and AI:} Industrial computer vision, OCR, inspection systems, OPC UA, Beckhoff PLCs, LLM-assisted engineering workflows, agentic automation',
    ],
  },
  fullstack: {
    summary:
      'Senior full-stack engineer with 10+ years of experience shipping Linux-based software, industrial systems, and web products. Strong across Python, JavaScript/TypeScript, SQL, React, Vue, FastAPI, SQLAlchemy/MySQL, Docker, and AWS, with a backend-heavy approach to building reliable user-facing and internal tools.',
    skills: [
      '\\textbf{Languages:} Python, JavaScript/TypeScript, SQL, C/C++, MATLAB \\\\',
      '\\textbf{Backend and Data:} FastAPI, SQLAlchemy, MySQL, REST APIs, relational data modeling \\\\',
      '\\textbf{Frontend and Product Delivery:} React, Vue, Vuetify, frontend/backend feature ownership, maintainable web applications \\\\',
      '\\textbf{Infra and Automation:} Linux, Git, Docker, AWS, production debugging, agentic automation',
    ],
  },
  platform: {
    summary:
      'Senior software engineer with 10+ years of experience building backend-heavy web products, production software, and Linux-based systems. Strong across Python, JavaScript/TypeScript, SQL, APIs, Docker, AWS, and production integrations, with a good fit for platform, backend, and data-adjacent engineering roles where reliability and system design matter.',
    skills: [
      '\\textbf{Languages:} Python, JavaScript/TypeScript, SQL, C/C++, MATLAB \\\\',
      '\\textbf{Backend and Data:} FastAPI, SQLAlchemy, MySQL, REST APIs, relational data modeling, platform-oriented service work \\\\',
      '\\textbf{Infra and Systems:} Linux, Git, Docker, AWS, OPC UA, Beckhoff PLCs, production integrations \\\\',
      '\\textbf{Automation and Delivery:} Incident investigation, cross-functional deployment work, LLM-assisted engineering workflows',
    ],
  },
  ai_automation: {
    summary:
      'Senior software engineer with 10+ years of experience building production software, automation-heavy systems, and web products. Strong across Python, JavaScript/TypeScript, SQL, Linux, APIs, Docker, and AWS, with recent emphasis on LLM-assisted engineering, agentic workflows, and pragmatic AI-adjacent product delivery rather than pure research.',
    skills: [
      '\\textbf{Languages:} Python, JavaScript/TypeScript, SQL, C/C++, MATLAB \\\\',
      '\\textbf{Backend and Data:} FastAPI, SQLAlchemy, MySQL, REST APIs, data-oriented backend development \\\\',
      '\\textbf{Automation and AI:} Agentic automation, LLM-assisted engineering workflows, deterministic tool-based systems, production pragmatism \\\\',
      '\\textbf{Infra and Product Delivery:} Linux, Git, Docker, AWS, reliable feature delivery across frontend and backend',
    ],
  },
  vision: {
    summary:
      'Senior software engineer with 10+ years of experience building industrial computer-vision systems, Linux-based production software, and web products. Strong across Python, C/C++, JavaScript/TypeScript, SQL, OCR, inspection systems, and real-world deployments, with a practical engineering focus on reliability, measurement, and production use rather than lab-only work.',
    skills: [
      '\\textbf{Languages:} Python, C/C++, JavaScript/TypeScript, SQL, MATLAB \\\\',
      '\\textbf{Vision Systems:} Industrial computer vision, OCR, inspection systems, measurement applications, production imaging workflows \\\\',
      '\\textbf{Software and Infra:} Linux, Git, Docker, React, Vue, APIs, production debugging \\\\',
      '\\textbf{Automation and Integration:} OPC UA, Beckhoff PLCs, commissioning, cross-functional factory and customer work',
    ],
  },
};

function replaceSection(tex, sectionName, nextSectionName, body) {
  const escapedSection = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedNext = nextSectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\\\section\\*\\{${escapedSection}\\}\\n)([\\s\\S]*?)(\\n\\n\\\\section\\*\\{${escapedNext}\\})`);
  if (!pattern.test(tex)) {
    throw new Error(`Could not locate section ${sectionName}`);
  }
  return tex.replace(pattern, `$1${body}$3`);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function escapeTex(value) {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function buildKeywordAwareProfile(job, track) {
  const profile = TRACK_CONTENT[track] || TRACK_CONTENT.general;
  const extraction = job.keywordExtraction || {};
  const matchedStrengths = unique(extraction.matchedCandidateStrengths || []).slice(0, 10);
  const headlineHints = unique(extraction.cvHeadlineHints || []).slice(0, 3);
  const summaryParts = [profile.summary];
  if (headlineHints.length > 0) {
    summaryParts.push(`Target alignment: ${headlineHints.map(escapeTex).join(' / ')}.`);
  }
  if (matchedStrengths.length > 0) {
    summaryParts.push(`Strongest role match: ${matchedStrengths.map(escapeTex).join(', ')}.`);
  }

  const skills = [...profile.skills];
  if (matchedStrengths.length > 0) {
    skills.push(`\\textbf{Role-specific match:} ${matchedStrengths.map(escapeTex).join(', ')}`);
  }

  return {
    summary: summaryParts.join(' '),
    skills,
  };
}

function renderVariant(baseTex, job, track) {
  const profile = buildKeywordAwareProfile(job, track);
  let tex = baseTex;
  tex = replaceSection(tex, 'Summary', 'Experience', `${profile.summary}`);
  tex = replaceSection(tex, 'Skills', 'Links', profile.skills.join('\n'));
  return `% Generated variant for ${CANDIDATE_DISPLAY_NAME}: ${job.company} — ${job.title}\n${tex}`;
}

function buildVariant({ compiler, texPath, workDir, stem }) {
  let result;
  if (compiler === 'latexmk') {
    result = spawnSync(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-halt-on-error', '-outdir=' + workDir, texPath],
      { encoding: 'utf8' },
    );
  } else {
    result = spawnSync(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', workDir, texPath],
      { encoding: 'utf8' },
    );
  }

  const pdfPath = path.join(workDir, `${path.basename(texPath, '.tex')}.pdf`);
  return {
    ok: result.status === 0 && fs.existsSync(pdfPath),
    pdfPath,
    details: `${result.stdout || ''}\n${result.stderr || ''}`.trim(),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!fs.existsSync(BASE_CV)) {
    throw new Error(`Base CV not found: ${BASE_CV}`);
  }
  if (!fs.existsSync(args.input)) {
    throw new Error(`Input jobs JSON not found: ${args.input}`);
  }

  const compiler = chooseCompiler();
  const baseTex = fs.readFileSync(BASE_CV, 'utf8');
  const inputJson = readJson(args.input);
  const jobs = Array.isArray(inputJson.results) ? inputJson.results : [];

  const selectedJobs = args.jobIndex !== null
    ? (jobs[args.jobIndex] ? [jobs[args.jobIndex]] : [])
    : jobs.slice(0, args.limit);

  if (selectedJobs.length === 0) {
    throw new Error('No jobs selected for CV variant generation');
  }

  const stamp = nowStamp();
  const outputDir = args.outputDir || path.join(OUTPUT_ROOT, stamp);
  ensureDir(outputDir);

  const usedStems = new Set();
  const manifest = {
    ok: true,
    generatedAt: new Date().toISOString(),
    runLabel: 'cv-variants',
    candidateDisplayName: CANDIDATE_DISPLAY_NAME,
    candidateFilenamePrefix: NAME_PREFIX,
    compiler,
    baseCv: BASE_CV,
    inputPath: args.input,
    outputDir,
    selectedCount: selectedJobs.length,
    variants: [],
  };

  log(`Generating ${selectedJobs.length} CV variants from ${args.input}`, args);

  for (const [index, job] of selectedJobs.entries()) {
    const track = chooseTrack(job);
    const stem = buildStem(job, usedStems);
    const workDir = path.join(outputDir, stem);
    const texPath = path.join(workDir, `${stem}.tex`);
    ensureDir(workDir);

    log(`Rendering variant ${index + 1}/${selectedJobs.length}: ${job.company} — ${job.title} [${track}]`, args);
    const renderedTex = renderVariant(baseTex, job, track);
    fs.writeFileSync(texPath, renderedTex, 'utf8');

    const build = buildVariant({ compiler, texPath, workDir, stem });
    const variant = {
      ok: build.ok,
      index,
      jobId: job.jobId || null,
      company: job.company || null,
      title: job.title || null,
      location: job.location || null,
      searchName: job.searchName || null,
      fitScore: job.fitScore ?? null,
      keywordExtractionStatus: job.keywordExtractionStatus || null,
      atsKeywords: job.keywordExtraction?.atsKeywords || [],
      matchedCandidateStrengths: job.keywordExtraction?.matchedCandidateStrengths || [],
      cvHeadlineHints: job.keywordExtraction?.cvHeadlineHints || [],
      track,
      stem,
      fileName: `${stem}.pdf`,
      texPath,
      pdfPath: build.pdfPath,
      link: job.link || null,
    };

    if (!build.ok) {
      manifest.ok = false;
      variant.error = 'Variant build failed';
      variant.buildLogTail = build.details.split('\n').slice(-80).join('\n');
    }

    manifest.variants.push(variant);
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  writeJson(manifestPath, manifest);
  ensureDir(OUTPUT_ROOT);
  writeJson(LATEST_MANIFEST, manifest);

  log(`CV variant run complete. Saved manifest to ${manifestPath}`, args);
  console.log(JSON.stringify({
    ...manifest,
    manifestPath,
    latestManifestPath: LATEST_MANIFEST,
  }, null, 2));

  if (!manifest.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    action: 'generate_cv_variants',
    error: error.message,
  }, null, 2));
  process.exit(1);
}
