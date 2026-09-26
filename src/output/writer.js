// The only place FeatureLens writes documentation to disk. It decides where
// files go and makes sure nothing lands outside `<repo>/<outputDir>/<featureId>/`.
// index.html and manifest.json are written only by writeFeatureDocument,
// which checks the existing output first and writes manifest.json last.

import fs from 'node:fs';
import path from 'node:path';
import { serializeManifest } from '../docs/store.js';
import { checkExistingOutput } from './existing.js';
import { stampDocument, readMarker, MarkerError } from './marker.js';

export class OutputError extends Error {}

/** Existing output that is not safe to replace. `existing` says why. */
export class OutputRefusedError extends OutputError {
  /** @param {import('./existing.js').ExistingOutput} existing */
  constructor(existing) {
    super(`refusing to overwrite: ${existing.message} (${existing.code})`);
    this.existing = existing;
  }
}

export const HTML_FILE = 'index.html';
export const MANIFEST_FILE = 'manifest.json';

const FEATURE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/**
 * @typedef {{ path: string, content: string }} OutputFile
 * `path` is POSIX, relative to the feature's output folder.
 */

/**
 * @typedef {object} OutputTarget
 * @property {string} repoRoot
 * @property {string} outputDir relative to repoRoot, as loaded by loadConfig
 * @property {string} featureId
 */

/**
 * Write auxiliary `files` into `<repoRoot>/<outputDir>/<featureId>/`. Each file
 * is written to a temporary name and renamed, so readers never see a partial
 * file. index.html and manifest.json are refused here; use writeFeatureDocument.
 *
 * @param {OutputTarget} target
 * @param {OutputFile[]} files
 * @returns {string[]} absolute paths written
 * @throws {OutputError} on any path that would escape the feature folder
 */
export function writeDocumentation(target, files) {
  for (const f of files) {
    if (!isSafeRelative(f.path)) throw new OutputError(`invalid output path "${f.path}"`);
    if (f.path === HTML_FILE || f.path === MANIFEST_FILE) {
      throw new OutputError(`${f.path} is written only by writeFeatureDocument`);
    }
  }
  const dir = featureDir(target);
  return files.map((f) => writeInside(dir, f.path, f.content));
}

/**
 * @typedef {object} FeatureWriteResult
 * @property {string[]} written absolute paths, in write order (index.html, then manifest.json)
 * @property {import('./existing.js').ExistingOutput} existing what was there before; report it,
 *   in particular `history-mismatch`
 * @property {boolean} forced true when unsafe existing output was replaced because of `force`
 */

/**
 * Write a feature's document: `html` stamped with its marker as index.html,
 * then `manifest` as manifest.json. manifest.json is written last, so an
 * interrupted write leaves a valid-hash HTML whose historyId the next run
 * detects and regenerates.
 *
 * Existing output is checked first (checkExistingOutput) and anything not
 * safe to regenerate is refused, including a manifest whose history does
 * not extend the existing manifest.json's (`history-regression`) and one that
 * changes a manual section without recording it (`manual-section-changed`). `force: true` replaces it anyway; callers
 * must only pass it after the user explicitly confirmed discarding it.
 *
 * @param {OutputTarget} target
 * @param {{ manifest: import('../manifest/types.js').Manifest, html: string }} document
 *   `html` is the renderer's output: `<!doctype html>` on line 1 and no marker
 * @param {{ force?: boolean }} [options]
 * @returns {FeatureWriteResult}
 * @throws {OutputRefusedError} when existing output is unsafe to replace and not forced
 * @throws {OutputError} on invalid input, paths, or a failed write or verification
 */
export function writeFeatureDocument(target, { manifest, html }, { force = false } = {}) {
  const identity = {
    featureId: manifest?.metadata?.feature?.id,
    schemaVersion: manifest?.schemaVersion,
    historyId: Array.isArray(manifest?.history) ? manifest.history.at(-1)?.id : undefined,
  };
  if (identity.featureId !== target.featureId) {
    throw new OutputError(`manifest feature id "${identity.featureId}" does not match target "${target.featureId}"`);
  }
  if (typeof identity.historyId !== 'string') throw new OutputError('manifest has no history entry');

  let stamped;
  try {
    stamped = stampDocument(html, identity);
  } catch (e) {
    if (e instanceof MarkerError) throw new OutputError(`cannot stamp index.html: ${e.message}`);
    throw e;
  }

  const dir = featureDir(target);
  const htmlPath = path.join(dir, HTML_FILE);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  const existing = checkExistingOutput(
    { html: readExisting(htmlPath, null), manifest: readExisting(manifestPath, 'utf8') },
    { featureId: target.featureId, history: manifest.history, sections: manifest.documentation?.sections },
  );
  if (!existing.ok && force !== true) throw new OutputRefusedError(existing);

  atomicWrite(htmlPath, stamped);
  const check = readMarker(fs.readFileSync(htmlPath));
  if (!check.ok || check.marker.historyId !== identity.historyId) {
    throw new OutputError(`index.html failed verification after writing; manifest.json was not written (${check.ok ? 'historyId' : check.code})`);
  }
  atomicWrite(manifestPath, serializeManifest(manifest));

  return { written: [htmlPath, manifestPath], existing, forced: !existing.ok };
}

/**
 * Write a manifest that is still being worked on (what `build` and `update`
 * produce) to `file`, which must be outside `<repoRoot>/<outputDir>`: only
 * writeFeatureDocument writes there, after the write gate. The directory
 * must exist; nothing is created. Written atomically, like everything here.
 *
 * @param {string} file
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {{ repoRoot: string, outputDir: string }} target
 * @returns {string} absolute path written
 * @throws {OutputError}
 */
export function writeWorkingManifest(file, manifest, { repoRoot, outputDir }) {
  const dest = path.resolve(file);
  let parent;
  try {
    parent = fs.realpathSync(path.dirname(dest));
  } catch {
    throw new OutputError(`cannot write ${file}: its directory does not exist`);
  }
  const target = path.join(parent, path.basename(dest));
  let out = path.resolve(fs.realpathSync(repoRoot), ...outputDir.split('/'));
  try {
    out = fs.realpathSync(out);
  } catch {
    // Not created yet, so nothing can be inside it.
  }
  if (isInsideOrRoot(out, target)) {
    throw new OutputError(`${file} is inside the output directory ${outputDir}; keep working files in a scratch directory (only render writes there)`);
  }
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch (e) {
    if (e.code !== 'ENOENT') throw new OutputError(`cannot inspect ${file}: ${e.code ?? e.message}`);
  }
  if (stat && !stat.isFile()) throw new OutputError(`${file} exists but is not a regular file`);
  return atomicWrite(target, serializeManifest(manifest));
}

/** Resolve (and create) the feature folder, confined to the repository. */
function featureDir({ repoRoot, outputDir, featureId }) {
  if (!FEATURE_ID.test(featureId)) throw new OutputError(`invalid feature id "${featureId}"`);
  if (typeof outputDir !== 'string' || path.posix.isAbsolute(outputDir) || outputDir.includes('\\')) {
    throw new OutputError(`output directory ${outputDir} is outside the repository: it must be a relative POSIX path`);
  }
  const root = fs.realpathSync(repoRoot);
  const segments = [...outputDir.split('/'), featureId].filter((seg) => seg !== '' && seg !== '.');
  if (!isInside(root, path.resolve(root, ...segments))) throw new OutputError(`output directory ${outputDir} is outside the repository`);
  if (segments.includes('..')) throw new OutputError(`output directory ${outputDir} must not contain ".."`);

  const dir = confinedMkdir(root, root, segments, `output directory ${outputDir}`);
  if (dir === root) throw new OutputError(`output directory ${outputDir} resolves to the repository root`);
  return dir;
}

/**
 * Create `segments` below `base` (a real path inside `root`, or `root`
 * itself) and return the real path of the result. Nothing is created until
 * every existing component has been resolved: each one that exists must be a
 * directory whose real path is inside `root`, so a symlink anywhere on the
 * way can't make mkdir create directories outside the repository. The
 * missing tail is then created one directory at a time below the last
 * verified one, and each new directory is checked again.
 *
 * @param {string} root real path of the repository
 * @param {string} base real path to start from
 * @param {string[]} segments plain path segments (no "", ".", "..")
 * @param {string} what how to name the path in errors
 * @param {string} [boundary] how to name `root` in errors
 */
function confinedMkdir(root, base, segments, what, boundary = 'the repository') {
  let real = base;
  let i = 0;
  for (; i < segments.length; i++) {
    const next = path.join(real, segments[i]);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (e) {
      if (e.code === 'ENOENT') break;
      throw new OutputError(`cannot inspect ${what}: ${e.message}`);
    }
    if (stat.isSymbolicLink()) {
      let target;
      try {
        target = fs.realpathSync(next);
      } catch (e) {
        throw new OutputError(`${what} contains a symlink that cannot be resolved (${segments.slice(0, i + 1).join('/')}): ${e.code ?? e.message}`);
      }
      if (!isInsideOrRoot(root, target)) throw new OutputError(`${what} resolves outside ${boundary}`);
      stat = fs.statSync(target);
      real = target;
    } else {
      real = next;
    }
    if (!stat.isDirectory()) throw new OutputError(`${what}: ${segments.slice(0, i + 1).join('/')} exists but is not a directory`);
  }

  for (; i < segments.length; i++) {
    const next = path.join(real, segments[i]);
    try {
      fs.mkdirSync(next);
    } catch (e) {
      if (e.code !== 'EEXIST') throw new OutputError(`cannot create ${what}: ${e.message}`);
    }
    // Something may have appeared at `next` between the check and mkdir.
    const stat = fs.lstatSync(next);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new OutputError(`${what}: ${segments.slice(0, i + 1).join('/')} changed while it was being created`);
    real = next;
  }

  // Belt and braces: the result must still resolve where we think it does.
  const resolved = fs.realpathSync(real);
  if (!isInsideOrRoot(root, resolved)) throw new OutputError(`${what} resolves outside ${boundary}`);
  return resolved;
}

/** Contents of an existing regular file, or null when it doesn't exist. */
function readExisting(file, encoding) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  if (!stat.isFile()) throw new OutputError(`${path.basename(file)} exists but is not a regular file`);
  return fs.readFileSync(file, encoding);
}

/** Write `content` to `dir/rel` (rel is POSIX, already checked by isSafeRelative). */
function writeInside(dir, rel, content) {
  const segments = rel.split('/');
  const parent = confinedMkdir(dir, dir, segments.slice(0, -1), `output path ${rel}`, 'the feature folder');
  return atomicWrite(path.join(parent, segments.at(-1)), content);
}

function atomicWrite(dest, content) {
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    // Remove a leftover temp file (or symlink) first, and never follow one.
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Leave whatever is at tmp; report the write failure, not the cleanup.
    }
    throw new OutputError(`cannot write ${dest}: ${e.message}`);
  }
  return dest;
}

function isSafeRelative(p) {
  return typeof p === 'string'
    && p.length > 0
    && !p.includes('\\')
    && !path.posix.isAbsolute(p)
    && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function isInside(root, p) {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isInsideOrRoot(root, p) {
  return p === root || isInside(root, p);
}
