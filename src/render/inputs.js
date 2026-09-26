// The renderer's inputs besides the manifest: source excerpts and stale
// entries, both supplied by the caller. Pure: checks them against the
// manifest's evidence and indexes them; reads nothing.

import crypto from 'node:crypto';

export class RenderError extends Error {}

/**
 * The cited lines of one evidence entry, as read by Claude Code from the
 * repository and handed to `featurelens render --excerpts` (loaded by
 * loadExcerptFile in src/docs/store.js). Not stored anywhere: it exists only
 * for one render call.
 *
 * `file`, `startLine` and `endLine` must equal the evidence entry's, and
 * `text` must hash to its `snippetHash`: the lines `startLine..endLine`
 * joined with "\n", CRLF normalized to LF, no trailing newline. So an
 * excerpt is always exactly the code the evidence was stamped from.
 *
 * @typedef {object} SourceExcerpt
 * @property {string} evidenceId
 * @property {string} file
 * @property {number} startLine
 * @property {number} endLine
 * @property {string} text
 */

/**
 * @typedef {object} RenderInputs
 * @property {SourceExcerpt[]} excerpts at most one per evidence id; none for stale evidence
 * @property {import('../validation/repository.js').StaleEntry[]} stale the `stale` list of the
 *   validation result the write gate accepted
 */

/**
 * Check `inputs` against `manifest` and index them by evidence id. Order in
 * the input arrays never affects the output.
 *
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {RenderInputs} inputs
 * @returns {{ excerpts: Map<string, SourceExcerpt>, stale: Map<string, import('../validation/repository.js').StaleEntry> }}
 * @throws {RenderError} when an excerpt or stale entry contradicts the manifest or each other
 */
export function indexInputs(manifest, inputs) {
  const { excerpts, stale } = inputs ?? {};
  if (!Array.isArray(excerpts)) throw new RenderError('excerpts must be an array');
  if (!Array.isArray(stale)) throw new RenderError('stale must be an array');
  const evidence = new Map(manifest.evidence.map((e) => [e.id, e]));

  const staleById = new Map();
  for (const s of stale) {
    if (!evidence.has(s?.evidenceId)) throw new RenderError(`stale entry for unknown evidence "${s?.evidenceId}"`);
    if (staleById.has(s.evidenceId)) throw new RenderError(`more than one stale entry for evidence "${s.evidenceId}"`);
    staleById.set(s.evidenceId, s);
  }

  const excerptById = new Map();
  for (const x of excerpts) {
    const ev = evidence.get(x?.evidenceId);
    if (!ev) throw new RenderError(`excerpt for unknown evidence "${x?.evidenceId}"`);
    if (excerptById.has(x.evidenceId)) throw new RenderError(`more than one excerpt for evidence "${x.evidenceId}"`);
    if (staleById.has(x.evidenceId)) throw new RenderError(`excerpt supplied for stale evidence "${x.evidenceId}"; stale evidence is shown without code`);
    if (x.file !== ev.file || x.startLine !== ev.startLine || x.endLine !== ev.endLine) {
      throw new RenderError(`excerpt for "${x.evidenceId}" is not ${ev.file}:${ev.startLine}-${ev.endLine}`);
    }
    if (typeof x.text !== 'string' || x.text.split('\n').length !== ev.endLine - ev.startLine + 1) {
      throw new RenderError(`excerpt for "${x.evidenceId}" must have ${ev.endLine - ev.startLine + 1} line(s) joined with "\\n"`);
    }
    if (excerptHash(x.text) !== ev.snippetHash) {
      throw new RenderError(`excerpt for "${x.evidenceId}" does not match its snippetHash`);
    }
    excerptById.set(x.evidenceId, x);
  }
  return { excerpts: excerptById, stale: staleById };
}

/** Same formula as hashSnippet in src/evidence/source.js, for text already joined. */
export function excerptHash(text) {
  return `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
