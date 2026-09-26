// HTML escaping for the renderer. Every dynamic value goes through `html`,
// which escapes interpolations unless they are fragments `html` built
// itself, so manifest data can't become markup by mistake.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text for use in element content and in double- or single-quoted
 * attribute values.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** A fragment of markup produced by `html`. Only `html` constructs these. */
export class Html {
  /** @param {string} markup */
  constructor(markup) {
    this.markup = markup;
  }

  toString() {
    return this.markup;
  }
}

/**
 * Tagged template: literal parts are trusted markup, interpolations are
 * escaped. An interpolated Html fragment is inserted as is; arrays are
 * rendered element by element; null, undefined and false render nothing.
 * @returns {Html}
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += fragment(v) + strings[i + 1];
  });
  return new Html(out);
}

function fragment(v) {
  if (v instanceof Html) return v.markup;
  if (Array.isArray(v)) return v.map(fragment).join('');
  if (v === null || v === undefined || v === false) return '';
  return escapeHtml(v);
}
