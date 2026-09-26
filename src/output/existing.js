// Decides whether a feature's output folder may be regenerated. Pure: the
// writer reads the existing files and passes their contents in. The HTML is
// never interpreted beyond its marker line and hash; manifest.json is the
// only source of content.

import { isDeepStrictEqual } from 'node:util';
import { readMarker } from './marker.js';

/**
 * @typedef {'absent' | 'html-absent' | 'in-sync' | 'history-mismatch'} SafeState
 * @typedef {import('./marker.js').MarkerProblem | 'manifest-missing' | 'manifest-unreadable' | 'feature-id-mismatch' | 'schema-version-mismatch' | 'history-regression' | 'manual-section-changed'} UnsafeState
 */

/**
 * How an incoming history fails to extend the existing one:
 * - `older`: it is a strict prefix of the existing history (an older state of the document)
 * - `replaced`: it contains none of the existing entries (a new document over an existing one)
 * - `removed`: an existing entry is missing
 * - `reordered`: an existing entry is at a different position
 * - `modified`: an existing entry's content differs
 * @typedef {'older' | 'replaced' | 'removed' | 'reordered' | 'modified'} HistoryRegressionReason
 */

/**
 * @typedef {object} HistoryRegression
 * @property {HistoryRegressionReason} reason
 * @property {number} existingLength entries in the existing manifest.json
 * @property {number} incomingLength entries in the manifest being written
 * @property {string} existingHistoryId last existing entry
 * @property {string | null} incomingHistoryId last incoming entry
 * @property {number} [index] first position where the histories diverge (removed, reordered, modified)
 * @property {string} [entryId] the existing entry at `index`
 */

/**
 * @typedef {object} ExistingOutput
 * @property {boolean} ok true when regenerating loses nothing
 * @property {SafeState | UnsafeState} code
 * @property {string} message
 * @property {import('./marker.js').Marker} [marker] present when the marker was read and its hash matched
 * @property {{ marker: string, manifest: string }} [historyIds] present for `history-mismatch`
 * @property {HistoryRegression} [historyRegression] present for `history-regression`
 * @property {string[]} [manualSections] present for `manual-section-changed`
 */

/**
 * Safe (ok):
 *   absent            neither file exists
 *   html-absent       only manifest.json exists; render it
 *   in-sync           marker hash valid and it matches manifest.json
 *   history-mismatch  marker hash valid, but its historyId is not manifest.json's
 *                     last history entry (e.g. a write interrupted before
 *                     manifest.json); the HTML is untouched generated output,
 *                     so it is regenerated from manifest.json and the
 *                     mismatch is reported
 * Unsafe (refused unless forced): every marker problem from readMarker, and
 *   manifest-missing, manifest-unreadable, feature-id-mismatch,
 *   schema-version-mismatch, history-regression and manual-section-changed.
 *
 * When `target.history` (the history of the manifest about to be written)
 * is given and the existing output is otherwise safe, it must be the
 * existing manifest.json's history, entry for entry, optionally followed
 * by new entries. Anything else would silently rewrite the document's
 * record of who changed what, so it is refused as `history-regression`
 * (see compareHistory). The feature id stays the only identity check: a
 * different history for the same feature is a regression, never "another
 * document".
 *
 * When `target.sections` is given too, every manual section of the existing
 * manifest.json must be in it unchanged (provenance aside), unless one of
 * the new history entries lists it in `changedSections`: FeatureLens never
 * rewrites manual content, so a change to it must be recorded as an update
 * the user asked for. Anything else is refused as `manual-section-changed`.
 *
 * @param {{ html: Buffer | null, manifest: string | null }} existing file contents, null when absent
 * @param {{ featureId: string, history?: unknown[], sections?: unknown[] }} target
 * @returns {ExistingOutput}
 */
export function checkExistingOutput({ html, manifest }, { featureId, history, sections }) {
  const result = checkFiles({ html, manifest }, { featureId });
  if (!result.ok || manifest === null || history === undefined) return result;

  const previous = JSON.parse(manifest);
  const marker = result.marker ? { marker: result.marker } : {};
  const regression = compareHistory(previous.history, history);
  if (regression) return unsafe('history-regression', describeRegression(regression), { ...marker, historyRegression: regression });

  if (sections === undefined) return result;
  const changed = changedManualSections(previous, history, sections);
  if (changed.length === 0) return result;
  return unsafe('manual-section-changed',
    `manual section ${changed.map((id) => `"${id}"`).join(', ')} differs from the existing manifest.json, and no new history entry records the change; `
    + 'manual sections change only when the user asks, recorded with update --edit-manual', { ...marker, manualSections: changed });
}

/**
 * Ids of the existing manual sections that `sections` removes or changes
 * (anything but `provenance`) without a history entry after the existing
 * ones listing them in `changedSections`. Called once the history extends
 * the existing one.
 */
function changedManualSections(previous, history, sections) {
  const incoming = new Map((Array.isArray(sections) ? sections : []).filter(isObject).map((s) => [s.id, s]));
  const recorded = new Set(history.slice(previous.history.length).flatMap((h) => (isObject(h) && Array.isArray(h.changedSections) ? h.changedSections : [])));
  const content = ({ provenance, ...rest }) => rest;
  return (previous.documentation?.sections ?? [])
    .filter((s) => isObject(s) && s.origin === 'manual' && !recorded.has(s.id))
    .filter((s) => !incoming.has(s.id) || !isDeepStrictEqual(content(s), content(incoming.get(s.id))))
    .map((s) => s.id);
}

function isObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Whether `incoming` extends `existing`: null when it is identical or
 * appends entries after an unchanged copy of every existing entry, else
 * what is wrong. Entries are compared by content (deep equality, key order
 * ignored), not only by id.
 *
 * @param {unknown[]} existing
 * @param {unknown[]} incoming
 * @returns {HistoryRegression | null}
 */
export function compareHistory(existing, incoming) {
  const list = Array.isArray(incoming) ? incoming : [];
  const same = (a, b) => isDeepStrictEqual(a, b);
  const idOf = (h) => (h !== null && typeof h === 'object' && typeof h.id === 'string' ? h.id : null);
  const base = {
    existingLength: existing.length,
    incomingLength: list.length,
    existingHistoryId: idOf(existing.at(-1)),
    incomingHistoryId: idOf(list.at(-1)),
  };

  const index = existing.findIndex((h, i) => !same(h, list[i]));
  if (index === -1) return null;
  if (list.length < existing.length && list.every((h, i) => same(h, existing[i]))) return { reason: 'older', ...base };
  if (!existing.some((h) => list.some((x) => same(h, x)))) return { reason: 'replaced', ...base };

  const entryId = idOf(existing[index]);
  let reason = 'removed';
  if (idOf(list[index]) === entryId && entryId !== null) reason = 'modified';
  else if (list.some((x, j) => j !== index && (same(x, existing[index]) || (entryId !== null && idOf(x) === entryId)))) reason = 'reordered';
  return { reason, ...base, index, entryId };
}

const REGRESSION_TEXT = {
  older: 'it is an older state of the existing history',
  replaced: 'it does not contain the existing history (a new document over an existing one)',
  removed: 'an existing history entry was removed',
  reordered: 'existing history entries were reordered',
  modified: 'an existing history entry was modified',
};

/** @param {HistoryRegression} r */
function describeRegression(r) {
  const at = r.index !== undefined ? ` at position ${r.index}${r.entryId ? ` ("${r.entryId}")` : ''}` : '';
  return `the manifest's history does not extend the existing manifest.json: ${REGRESSION_TEXT[r.reason]}${at}; `
    + `existing history has ${r.existingLength} entr${r.existingLength === 1 ? 'y' : 'ies'} ending at "${r.existingHistoryId}", `
    + `the new one has ${r.incomingLength} ending at "${r.incomingHistoryId ?? 'none'}". `
    + 'Start from the existing manifest.json and record changes with recordUpdate';
}

/** The file-level checks: marker, identity and consistency of the two existing files. */
function checkFiles({ html, manifest }, { featureId }) {
  if (html === null && manifest === null) return safe('absent', 'no existing output');

  let current = null;
  if (manifest !== null) {
    current = summarize(manifest);
    if (!current) return unsafe('manifest-unreadable', 'existing manifest.json is not a readable FeatureLens manifest');
    if (current.featureId !== featureId) {
      return unsafe('feature-id-mismatch', `existing manifest.json is for feature "${current.featureId}", not "${featureId}"`);
    }
  }
  if (html === null) return safe('html-absent', 'index.html is missing; it will be rendered from manifest.json');

  const reading = readMarker(html);
  if (!reading.ok) return unsafe(reading.code, `existing index.html: ${reading.message}`);
  const { marker } = reading;
  if (!current) return unsafe('manifest-missing', 'index.html exists without manifest.json; its source is gone', { marker });
  if (marker.featureId !== featureId) {
    return unsafe('feature-id-mismatch', `existing index.html is for feature "${marker.featureId}", not "${featureId}"`, { marker });
  }
  if (marker.schemaVersion !== current.schemaVersion) {
    return unsafe('schema-version-mismatch', `existing index.html has schema ${marker.schemaVersion}, manifest.json has ${current.schemaVersion}`, { marker });
  }
  if (marker.historyId !== current.historyId) {
    return safe('history-mismatch',
      `existing index.html was generated at history "${marker.historyId}" but manifest.json is at "${current.historyId}"; regenerating from manifest.json`,
      { marker, historyIds: { marker: marker.historyId, manifest: current.historyId } });
  }
  return safe('in-sync', 'existing output is intact generated output', { marker });
}

/**
 * The fields the check needs from manifest.json text, or null when they
 * can't be read. Full validation is the caller's job (validateManifest).
 * @param {string} text
 */
function summarize(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  const featureId = m?.metadata?.feature?.id;
  const last = Array.isArray(m?.history) ? m.history.at(-1) : undefined;
  if (typeof m?.schemaVersion !== 'string' || typeof featureId !== 'string' || typeof last?.id !== 'string') return null;
  return { schemaVersion: m.schemaVersion, featureId, historyId: last.id };
}

function safe(code, message, extra = {}) {
  return { ok: true, code, message, ...extra };
}

function unsafe(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}
