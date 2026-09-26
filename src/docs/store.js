// Loading and serializing manifests, and loading excerpt files for render.
// Validation is separate (src/validation/validate.js, src/render/inputs.js);
// this module only turns bytes into objects and back.

import fs from 'node:fs';

export class ManifestLoadError extends Error {}

/**
 * Read and parse a manifest JSON file. Does not validate it.
 * @param {string} file
 * @returns {unknown}
 * @throws {ManifestLoadError} when the file cannot be read or is not JSON
 */
export function loadManifestFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ManifestLoadError(`cannot read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ManifestLoadError(`${file} is not valid JSON: ${e.message}`);
  }
}

export class ExcerptLoadError extends Error {}

const EXCERPT_KEYS = ['evidenceId', 'file', 'startLine', 'endLine', 'text'];

/**
 * Read an excerpt file: a JSON array of SourceExcerpt objects
 * (src/render/inputs.js), written by Claude Code for one render. Checks only
 * the shape: exactly the five keys, with string or integer values. Whether
 * each excerpt matches the manifest is indexInputs' job.
 * @param {string} file
 * @returns {import('../render/inputs.js').SourceExcerpt[]}
 * @throws {ExcerptLoadError} when the file cannot be read, is not JSON, or has the wrong shape
 */
export function loadExcerptFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ExcerptLoadError(`cannot read ${file}: ${e.message}`);
  }
  let excerpts;
  try {
    excerpts = JSON.parse(text);
  } catch (e) {
    throw new ExcerptLoadError(`${file} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(excerpts)) throw new ExcerptLoadError(`${file} must contain a JSON array of excerpts`);
  excerpts.forEach((x, i) => {
    const at = `${file}: excerpt ${i}`;
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new ExcerptLoadError(`${at} must be an object`);
    const keys = Object.keys(x);
    if (keys.length !== EXCERPT_KEYS.length || !EXCERPT_KEYS.every((k) => keys.includes(k))) {
      throw new ExcerptLoadError(`${at} must have exactly the keys ${EXCERPT_KEYS.join(', ')}`);
    }
    for (const k of ['evidenceId', 'file', 'text']) {
      if (typeof x[k] !== 'string') throw new ExcerptLoadError(`${at}: ${k} must be a string`);
    }
    for (const k of ['startLine', 'endLine']) {
      if (!Number.isInteger(x[k])) throw new ExcerptLoadError(`${at}: ${k} must be an integer`);
    }
  });
  return excerpts;
}

/**
 * Stable, diff-friendly JSON: two-space indent, trailing newline, key order
 * as constructed.
 * @param {import('../manifest/types.js').Manifest} manifest
 */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
