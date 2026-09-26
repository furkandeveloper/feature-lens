import { createRequire } from 'node:module';
import { validateSchema } from '../schema/json-schema.js';
import { checkSchemaVersion } from '../version.js';
import { createReport } from './report.js';
import { checkSemantics } from './semantic.js';
import { checkAgainstRepository } from './repository.js';

const require = createRequire(import.meta.url);
export const manifestSchema = require('../../schema/featurelens-manifest.schema.json');

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid true when there are no errors; warnings do not affect it
 * @property {import('./report.js').Issue[]} errors
 * @property {import('./report.js').Issue[]} warnings
 * @property {import('./repository.js').StaleEntry[]} stale evidence the repository has moved on from; empty unless evidenceChecked
 * @property {boolean} evidenceChecked whether evidence was verified against repository files
 */

/**
 * Validate a FeatureLens manifest in layers:
 *
 * 1. schema version is supported
 * 2. JSON Schema (structure, types, required fields, id and path formats)
 * 3. semantics (references, graphs, sections, history, certainty rules)
 * 4. with `repoRoot`: evidence and file paths against the actual repository.
 *    Paths that escape the repository are errors. Evidence whose cited
 *    lines moved, changed or disappeared goes to `stale`, not `errors`:
 *    the manifest is still valid, but the document is out of date.
 *
 * Layers 3 and 4 only run once 1 and 2 pass, because they rely on that shape.
 * They run together so one pass reports everything that needs fixing.
 *
 * @param {unknown} manifest
 * @param {{ repoRoot?: string }} [options]
 * @returns {ValidationResult}
 */
export function validateManifest(manifest, { repoRoot } = {}) {
  const report = createReport();
  let evidenceChecked = false;
  /** @type {import('./repository.js').StaleEntry[]} */
  let stale = [];
  const done = () => ({ valid: report.errors.length === 0, errors: report.errors, warnings: report.warnings, stale, evidenceChecked });

  const hasVersion = typeof manifest === 'object' && manifest !== null && 'schemaVersion' in manifest;
  if (hasVersion) {
    const problem = checkSchemaVersion(/** @type {any} */ (manifest).schemaVersion);
    if (problem) {
      report.error('version.unsupported', '/schemaVersion', problem);
      return done();
    }
  }

  for (const e of validateSchema(manifest, manifestSchema)) {
    report.error(`schema.${e.keyword}`, e.path, e.message);
  }
  if (report.errors.length > 0) return done();

  const m = /** @type {import('../manifest/types.js').Manifest} */ (manifest);
  const citations = checkSemantics(m, report);
  if (repoRoot) {
    stale = checkAgainstRepository(m, repoRoot, report, citations);
    evidenceChecked = true;
  }
  return done();
}
