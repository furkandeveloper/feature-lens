// Assembling manifests and recording updates. Pure functions: callers pass
// in the analysis and metadata, get back a new manifest plus its validation
// result, and decide whether to write it. Nothing here touches the filesystem
// except validation reading source files when `repoRoot` is given.

import { SCHEMA_VERSION, TOOL_VERSION } from '../version.js';
import { validateManifest } from '../validation/validate.js';

/** @typedef {import('./types.js').Manifest} Manifest */
/** @typedef {import('./types.js').HistoryEntry} HistoryEntry */
/** @typedef {import('../validation/validate.js').ValidationResult} ValidationResult */

const PENDING = Object.freeze({ valid: true, errorCount: 0, warningCount: 0, evidenceChecked: false });

/**
 * Create a new manifest with a single "created" history entry that owns
 * every section.
 *
 * @param {object} input
 * @param {import('./types.js').Metadata['feature']} input.feature
 * @param {import('./types.js').Metadata['repository']} input.repository
 * @param {import('./types.js').Person} input.generatedBy
 * @param {import('./types.js').Contributor[]} [input.contributors]
 * @param {import('./types.js').SourceRef[]} input.evidence
 * @param {import('./types.js').Analysis} input.analysis
 * @param {import('./types.js').Visualizations} [input.visualizations]
 * @param {Omit<import('./types.js').Section, 'provenance'>[]} input.sections
 * @param {string} input.summary what this analysis covers, for the history entry
 * @param {Date} [input.now]
 * @param {string} [input.repoRoot] verify evidence against this repository
 * @returns {{ manifest: Manifest, validation: ValidationResult }}
 */
export function createManifest(input) {
  const at = (input.now ?? new Date()).toISOString();
  const historyId = 'h-1';

  /** @type {Manifest} */
  const manifest = asJson({
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      feature: input.feature,
      repository: input.repository,
      tool: { name: 'featurelens', version: TOOL_VERSION },
      generatedAt: at,
      updatedAt: at,
      generatedBy: input.generatedBy,
      contributors: input.contributors ?? [],
    },
    evidence: input.evidence,
    analysis: input.analysis,
    visualizations: input.visualizations ?? {},
    documentation: {
      sections: input.sections.map((s) => ({ ...s, provenance: { historyId } })),
    },
    history: [{
      id: historyId,
      at,
      action: 'created',
      by: input.generatedBy,
      toolVersion: TOOL_VERSION,
      summary: input.summary,
      ...(input.repository.revision ? { revision: input.repository.revision } : {}),
      changedFiles: [],
      changedSections: input.sections.map((s) => s.id),
      validation: { ...PENDING },
    }],
  });

  return finalize(manifest, input.repoRoot);
}

/**
 * Append an "updated" history entry to a manifest whose content the caller
 * has already changed. Sets section provenance for `changedSections`, moves
 * `updatedAt` and the repository revision forward, and chains
 * `previousRevision` to the last entry. Does not modify `manifest`.
 *
 * @param {Manifest} manifest
 * @param {object} update
 * @param {import('./types.js').Person} update.by
 * @param {string} update.summary
 * @param {string[]} update.changedSections section ids whose content this update wrote
 * @param {string[]} [update.changedFiles] source files changed since the previous revision
 * @param {string} [update.revision] repository revision the update was produced from
 * @param {Date} [update.now]
 * @param {string} [update.repoRoot]
 * @returns {{ manifest: Manifest, validation: ValidationResult }}
 */
export function recordUpdate(manifest, update) {
  const next = asJson(manifest);
  const at = (update.now ?? new Date()).toISOString();
  const previous = next.history.at(-1);
  const id = `h-${next.history.length + 1}`;

  /** @type {HistoryEntry} */
  const entry = asJson({
    id,
    at,
    action: 'updated',
    by: update.by,
    toolVersion: TOOL_VERSION,
    summary: update.summary,
    ...(previous.revision ? { previousRevision: previous.revision } : {}),
    ...(update.revision ? { revision: update.revision } : {}),
    changedFiles: update.changedFiles ?? [],
    changedSections: update.changedSections,
    validation: { ...PENDING },
  });
  next.history.push(entry);

  const changed = new Set(update.changedSections);
  for (const section of next.documentation.sections) {
    if (changed.has(section.id)) section.provenance = { historyId: id };
  }

  next.metadata.updatedAt = at;
  next.metadata.tool.version = TOOL_VERSION;
  if (update.revision) next.metadata.repository.revision = update.revision;
  else delete next.metadata.repository.revision;

  return finalize(next, update.repoRoot);
}

/**
 * Sections whose rendered content depends on any of `evidenceIds`, in
 * manifest order: the input for `changedSections` when evidence was
 * relocated, re-stamped, added or removed. It follows the data each
 * section presents (src/render/render.js), and nothing else:
 *
 * - any section: its own `sourceRefs`, the findings placed in it, and the
 *   visualizations it lists whose claims cite the evidence (listed by title
 *   today; their claims still depend on it)
 * - generated sections only, by kind: `architecture` (components,
 *   relationships), `implementation` (files), `impact` (items and impact
 *   relationships), `risks`, `testing`, `unknowns` (their notes), and
 *   `references` (the evidence catalog, which lists every entry, so any
 *   evidence id affects it)
 *
 * `overview`, `scope`, `flows`, `custom` and `history` show no evidence.
 * Manual sections are returned separately: FeatureLens never rewrites
 * them, so they go in `changedSections` only when the user edited them.
 * Pure; ids not in the manifest are matched like any other.
 *
 * @param {Manifest} manifest
 * @param {Iterable<string>} evidenceIds
 * @returns {{ generated: string[], manual: string[] }}
 */
export function sectionsCitingEvidence(manifest, evidenceIds) {
  const ids = new Set(evidenceIds);
  const cites = (item) => (item.evidence ?? []).some((id) => ids.has(id));
  const any = (...lists) => lists.some((list) => list.some(cites));
  const { analysis } = manifest;
  const byKind = {
    architecture: () => any(analysis.components, analysis.relationships),
    implementation: () => any(analysis.files),
    impact: () => any(analysis.impact.items, analysis.impact.relationships),
    risks: () => any(analysis.risks),
    testing: () => any(analysis.testing),
    unknowns: () => any(analysis.unknowns),
    references: () => ids.size > 0,
  };
  const vizCiting = new Set();
  for (const list of Object.values(manifest.visualizations)) {
    for (const v of list ?? []) if (citesDeep(v, ids)) vizCiting.add(v.id);
  }

  const out = { generated: [], manual: [] };
  for (const s of manifest.documentation.sections) {
    const generated = s.origin === 'generated';
    const affected = (s.sourceRefs ?? []).some((id) => ids.has(id))
      || analysis.findings.some((f) => f.section === s.id && cites(f))
      || (s.visualizations ?? []).some((id) => vizCiting.has(id))
      || (generated && Object.hasOwn(byKind, s.kind) && byKind[s.kind]());
    if (affected) out[generated ? 'generated' : 'manual'].push(s.id);
  }
  return out;
}

/** Whether any claim nested in `value` cites one of `ids`. */
function citesDeep(value, ids) {
  if (Array.isArray(value)) return value.some((x) => citesDeep(x, ids));
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value.evidence) && value.evidence.some((id) => ids.has(id))) return true;
  return Object.values(value).some((x) => citesDeep(x, ids));
}

/**
 * A deep copy as JSON data: exactly what serializeManifest writes and a
 * reader gets back. Properties set to `undefined` (e.g. `parent: undefined`
 * from a build script) are dropped here, so the manifest that is validated,
 * and whose result is recorded in history, is the one that gets written.
 */
function asJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Validate, then record the result in the newest history entry. */
function finalize(manifest, repoRoot) {
  const validation = validateManifest(manifest, { repoRoot });
  manifest.history.at(-1).validation = {
    valid: validation.valid,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    evidenceChecked: validation.evidenceChecked,
  };
  return { manifest, validation };
}
