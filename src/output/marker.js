// The self-hash marker on line 2 of every generated index.html. Pure: no I/O.
//
//   line 1  <!doctype html>
//   line 2  <!-- featurelens {"featureId":"…","schemaVersion":"…","historyId":"…","sha256":"<64 hex>"} -->
//
// `sha256` covers the document's UTF-8 bytes with line 2 and its "\n"
// removed, so the marker never hashes itself. Parsing is byte-exact: the
// line must be exactly what markerLine() produces for its fields.

import crypto from 'node:crypto';

/** Marker keys, in the only order a marker may use. */
export const MARKER_KEYS = Object.freeze(['featureId', 'schemaVersion', 'historyId', 'sha256']);

// Any occurrence of TAG counts as a marker, so a second one can't hide mid-line.
const TAG = '<!-- featurelens';
const PREFIX = `${TAG} `;
const SUFFIX = ' -->';
const DOCTYPE = /^<!doctype html>$/i;
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NL = 0x0a;
const TAG_BYTES = Buffer.from(TAG, 'utf8');

export class MarkerError extends Error {}

/**
 * @typedef {object} Marker
 * @property {string} featureId
 * @property {string} schemaVersion
 * @property {string} historyId
 * @property {string} sha256 64 lowercase hex characters
 */

/**
 * @typedef {'marker-missing' | 'marker-wrong-line' | 'marker-duplicate' | 'marker-malformed' | 'marker-invalid' | 'hash-mismatch'} MarkerProblem
 */

/**
 * @typedef {{ ok: true, marker: Marker } | { ok: false, code: MarkerProblem, message: string }} MarkerReading
 */

/**
 * The marker line for `fields`, without a newline. Keys are always written in
 * MARKER_KEYS order, whatever order `fields` has.
 * @param {Marker} fields
 * @returns {string}
 * @throws {MarkerError} when a field is missing or malformed
 */
export function markerLine(fields) {
  if (fields === null || typeof fields !== 'object') throw new MarkerError('marker must be an object');
  const ordered = Object.fromEntries(MARKER_KEYS.filter((k) => k in fields).map((k) => [k, fields[k]]));
  const problem = checkFields(Object.keys(fields).length === MARKER_KEYS.length ? ordered : fields);
  if (problem) throw new MarkerError(problem);
  return `${PREFIX}${JSON.stringify(ordered)}${SUFFIX}`;
}

/**
 * `sha256` hex of the bytes a marker covers.
 * @param {Buffer | string} unmarked the document without its marker line
 */
export function hashDocument(unmarked) {
  return crypto.createHash('sha256').update(toBytes(unmarked)).digest('hex');
}

/**
 * Insert the marker as line 2 of `html`, hashing everything else.
 * @param {string} html a complete document whose first line is `<!doctype html>`, with no marker
 * @param {{ featureId: string, schemaVersion: string, historyId: string }} identity
 * @returns {string}
 * @throws {MarkerError} when `html` has no doctype line or already contains a marker
 */
export function stampDocument(html, { featureId, schemaVersion, historyId }) {
  if (typeof html !== 'string') throw new MarkerError('document must be a string');
  const nl = html.indexOf('\n');
  if (nl === -1 || !DOCTYPE.test(html.slice(0, nl))) {
    throw new MarkerError('document must start with a "<!doctype html>" line');
  }
  if (html.includes(TAG)) throw new MarkerError('document already contains a featurelens marker');
  const line = markerLine({ featureId, schemaVersion, historyId, sha256: hashDocument(html) });
  return `${html.slice(0, nl + 1)}${line}\n${html.slice(nl + 1)}`;
}

/**
 * Find, parse and hash-check the marker of a generated document. Never
 * interprets the rest of the HTML: it only splits lines and hashes bytes.
 *
 * Checks run in this order and the first failure is returned: exactly one
 * marker, on line 2, byte-exact format, valid fields, matching hash.
 *
 * @param {Buffer | string} document the file's bytes
 * @returns {MarkerReading}
 */
export function readMarker(document) {
  const bytes = toBytes(document);
  const count = countOccurrences(bytes, TAG_BYTES);
  if (count === 0) return fail('marker-missing', 'no featurelens marker');
  if (count > 1) return fail('marker-duplicate', `${count} featurelens markers; expected exactly one`);

  const end1 = bytes.indexOf(NL);
  const end2 = end1 === -1 ? -1 : bytes.indexOf(NL, end1 + 1);
  const line2 = end1 === -1 ? null : bytes.subarray(end1 + 1, end2 === -1 ? bytes.length : end2);
  const markerOnLine2 = line2 !== null && line2.subarray(0, TAG_BYTES.length).equals(TAG_BYTES);
  if (!markerOnLine2) return fail('marker-wrong-line', 'the featurelens marker must be on line 2');
  if (end2 === -1) return fail('marker-malformed', 'the marker line must end with a newline');
  if (!DOCTYPE.test(bytes.subarray(0, end1).toString('utf8'))) {
    return fail('marker-malformed', 'line 1 must be "<!doctype html>"');
  }

  const text = line2.toString('utf8');
  if (!text.startsWith(PREFIX) || !text.endsWith(SUFFIX)) {
    return fail('marker-malformed', 'the marker line must be "<!-- featurelens {…} -->"');
  }
  let fields;
  try {
    fields = JSON.parse(text.slice(PREFIX.length, text.length - SUFFIX.length));
  } catch (e) {
    return fail('marker-malformed', `the marker is not valid JSON: ${e.message}`);
  }
  const problem = checkFields(fields);
  if (problem) return fail('marker-invalid', problem);
  if (text !== markerLine(fields)) {
    return fail('marker-malformed', 'the marker line is not in canonical form');
  }

  const unmarked = Buffer.concat([bytes.subarray(0, end1 + 1), bytes.subarray(end2 + 1)]);
  if (hashDocument(unmarked) !== fields.sha256) {
    return fail('hash-mismatch', 'the document does not match its marker hash; it was edited after it was generated');
  }
  return { ok: true, marker: fields };
}

/** @returns {string | null} what is wrong with `fields`, or null */
function checkFields(fields) {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return 'marker must be a JSON object';
  const keys = Object.keys(fields);
  if (keys.length !== MARKER_KEYS.length || keys.some((k, i) => k !== MARKER_KEYS[i])) {
    if (keys.length === MARKER_KEYS.length && MARKER_KEYS.every((k) => keys.includes(k))) {
      return `marker keys must be in the order ${MARKER_KEYS.join(', ')}`;
    }
    return `marker must have exactly the keys ${MARKER_KEYS.join(', ')}`;
  }
  if (typeof fields.featureId !== 'string' || !ID.test(fields.featureId)) return 'marker featureId is not a valid id';
  if (typeof fields.schemaVersion !== 'string' || !SEMVER.test(fields.schemaVersion)) return 'marker schemaVersion is not a semver string';
  if (typeof fields.historyId !== 'string' || !ID.test(fields.historyId)) return 'marker historyId is not a valid id';
  if (typeof fields.sha256 !== 'string' || !SHA256.test(fields.sha256)) return 'marker sha256 must be 64 lowercase hex characters';
  return null;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

function toBytes(document) {
  return Buffer.isBuffer(document) ? document : Buffer.from(document, 'utf8');
}

function fail(code, message) {
  return { ok: false, code, message };
}
