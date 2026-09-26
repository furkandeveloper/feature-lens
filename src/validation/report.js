/**
 * A validation finding. `code` is stable and meant for programs and tests;
 * `message` is for people. `path` is a JSON Pointer into the manifest.
 * @typedef {{ code: string, path: string, message: string }} Issue
 */

/** Collects errors and warnings during one validation run. */
export function createReport() {
  /** @type {Issue[]} */
  const errors = [];
  /** @type {Issue[]} */
  const warnings = [];
  return {
    errors,
    warnings,
    /** @param {string} code @param {string} path @param {string} message */
    error: (code, path, message) => errors.push({ code, path, message }),
    /** @param {string} code @param {string} path @param {string} message */
    warn: (code, path, message) => warnings.push({ code, path, message }),
  };
}

/** @typedef {ReturnType<typeof createReport>} Report */

/**
 * Collect the ids of `items`, reporting duplicates.
 * @param {object[]} items
 * @param {string} path JSON Pointer of the array
 * @param {Report} report
 * @param {string} [field] property holding the id
 */
export function uniqueIds(items, path, report, field = 'id') {
  const seen = new Set();
  items.forEach((item, i) => {
    const id = item[field];
    if (seen.has(id)) report.error('id.duplicate', `${path}/${i}/${field}`, `duplicate ${field} "${id}"`);
    seen.add(id);
  });
  return seen;
}

/**
 * Ids reachable from `start` following `edges` (a map of id to neighbor ids).
 * @param {string[]} start
 * @param {Map<string, string[]>} edges
 */
export function reachable(start, edges) {
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length > 0) {
    for (const next of edges.get(queue.shift()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
