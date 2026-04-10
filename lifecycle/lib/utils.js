const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { config } = require('./config');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function slugify(value) {
  return String(value || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function nowIso() {
  return new Date().toISOString();
}

function stampForFile(date = new Date()) {
  return date.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function buildJobDedupeKey(job) {
  const raw = [
    job.source || 'linkedin',
    job.jobId || '',
    job.link || '',
    job.company || '',
    job.title || '',
    job.location || '',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function writeJsonArtifact(kind, payload, options = {}) {
  ensureDir(config.artifactRoot);
  const dir = ensureDir(path.join(config.artifactRoot, kind));
  const stamp = stampForFile();
  const suffix = options.fileSuffix ? `-${slugify(options.fileSuffix)}` : '';
  const filePath = path.join(dir, `${stamp}${suffix}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function writeTextArtifact(kind, extension, content, options = {}) {
  ensureDir(config.artifactRoot);
  const dir = ensureDir(path.join(config.artifactRoot, kind));
  const stamp = stampForFile();
  const suffix = options.fileSuffix ? `-${slugify(options.fileSuffix)}` : '';
  const filePath = path.join(dir, `${stamp}${suffix}.${extension}`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || config.workspaceRoot,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.streamStdout) {
        process.stdout.write(text);
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.streamStderr) {
        process.stderr.write(text);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(' ')} failed with exit ${code}\n${stderr.trim() || stdout.trim()}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isBrowserClosedError(error) {
  const message = String(error && error.message ? error.message : error);
  return /Target page, context or browser has been closed/i.test(message);
}

module.exports = {
  ensureDir,
  slugify,
  nowIso,
  stampForFile,
  buildJobDedupeKey,
  writeJsonArtifact,
  writeTextArtifact,
  runCommand,
  isBrowserClosedError,
};
