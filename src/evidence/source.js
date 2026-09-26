// Reading cited source lines. Evidence collection and validation both go
// through here, so "the file exists, stays inside the repository, and has
// these lines" means the same thing everywhere.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class EvidenceError extends Error {}

/**
 * Why a path was rejected. `invalid` and `outside` are safety failures: the
 * path must never be read. `not-found` and `not-file` mean the repository has
 * no regular file there (any more). `unreadable` means the file (or a
 * directory on its path) exists but can't be read, e.g. permissions.
 * @typedef {{ error: string, reason: 'invalid' | 'outside' | 'not-found' | 'not-file' | 'unreadable' }} PathError
 */

/**
 * Resolve a manifest file path to an absolute path, refusing anything that
 * would escape the repository (absolute paths, `..`, symlinks pointing out).
 * @param {string} realRoot repository root, already passed through realpath
 * @param {string} file POSIX path relative to the root
 * @returns {string | PathError}
 */
export function resolveInsideRepo(realRoot, file) {
  if (file.includes('\\')) return { error: 'must use forward slashes', reason: 'invalid' };
  if (path.posix.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) return { error: 'must be relative to the repository root', reason: 'invalid' };
  if (path.posix.normalize(file) !== file || file.split('/').includes('..')) {
    return { error: 'must be a normalized path without "." or ".." segments', reason: 'invalid' };
  }

  const candidate = path.join(realRoot, ...file.split('/'));
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { error: `file not found in repository: ${file}`, reason: 'not-found' };
    return { error: `cannot read ${file}: ${e.code ?? e.message}`, reason: 'unreadable' };
  }
  const rel = path.relative(realRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { error: `resolves outside the repository: ${file}`, reason: 'outside' };
  if (!fs.statSync(real).isFile()) return { error: `not a regular file: ${file}`, reason: 'not-file' };
  return real;
}

/**
 * sha256 of lines `startLine..endLine` (1-based, inclusive) joined with "\n".
 * Line endings are already normalized by {@link SourceTree.lines}.
 * @param {string[]} lines
 */
export function hashSnippet(lines, startLine, endLine) {
  const snippet = lines.slice(startLine - 1, endLine).join('\n');
  return `sha256:${crypto.createHash('sha256').update(snippet, 'utf8').digest('hex')}`;
}

/**
 * Every window of `length` lines whose hash is `snippetHash`, in file order.
 * Used to tell cited code that moved from cited code that changed.
 * @param {string[]} lines
 * @param {number} length lines per window
 * @param {string} snippetHash
 * @returns {{ startLine: number, endLine: number }[]}
 */
export function findSnippet(lines, length, snippetHash) {
  const matches = [];
  for (let start = 1; start + length - 1 <= lines.length; start++) {
    if (hashSnippet(lines, start, start + length - 1) === snippetHash) {
      matches.push({ startLine: start, endLine: start + length - 1 });
    }
  }
  return matches;
}

/** Read-only, cached view of the files in one repository. */
export class SourceTree {
  /** @param {string} repoRoot */
  constructor(repoRoot) {
    this.root = fs.realpathSync(repoRoot);
    /** @type {Map<string, string[]>} */
    this.cache = new Map();
  }

  /** @returns {string | PathError} absolute path, or why it is rejected */
  resolve(file) {
    return resolveInsideRepo(this.root, file);
  }

  /** Whether `file` exists inside the repository as a regular file. */
  exists(file) {
    return typeof this.resolve(file) === 'string';
  }

  /**
   * Lines of `file`, without a phantom empty line for a trailing newline.
   * @returns {string[] | PathError}
   */
  lines(file) {
    const resolved = this.resolve(file);
    if (typeof resolved !== 'string') return resolved;
    if (!this.cache.has(resolved)) {
      let text;
      try {
        text = fs.readFileSync(resolved, 'utf8');
      } catch (e) {
        return { error: `cannot read ${file}: ${e.code ?? e.message}`, reason: 'unreadable' };
      }
      const lines = text.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      this.cache.set(resolved, lines);
    }
    return this.cache.get(resolved);
  }
}

/**
 * Build a source reference from a location the analysis wants to cite,
 * after checking it against the repository. The only way to get a
 * `snippetHash` is to read the real lines, so a fabricated location cannot
 * produce a valid reference.
 *
 * @param {SourceTree} tree
 * @param {Omit<import('../manifest/types.js').SourceRef, 'snippetHash'>} input
 * @returns {{ ref: import('../manifest/types.js').SourceRef, warnings: string[] }}
 * @throws {EvidenceError} when the file or line range does not exist
 */
export function createSourceRef(tree, input) {
  const { file, startLine, endLine, symbol } = input;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new EvidenceError(`${file}: invalid line range ${startLine}-${endLine}`);
  }
  const lines = tree.lines(file);
  if (!Array.isArray(lines)) throw new EvidenceError(`${file}: ${lines.error}`);
  if (endLine > lines.length) {
    throw new EvidenceError(`${file} has ${lines.length} lines, but the reference ends at line ${endLine}`);
  }

  const warnings = [];
  if (symbol && !lines.slice(startLine - 1, endLine).join('\n').includes(symbol)) {
    warnings.push(`"${symbol}" does not appear in ${file}:${startLine}-${endLine}`);
  }
  return { ref: { ...input, snippetHash: hashSnippet(lines, startLine, endLine) }, warnings };
}
