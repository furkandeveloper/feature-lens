// The two document workflows, as data: turning Claude's draft into a new
// manifest (buildFromDraft), and turning a revised copy of an existing
// manifest into its next history entry (planUpdate, then recordUpdate).
// No I/O beyond reading cited source lines through SourceTree; the CLI
// supplies git metadata and decides what to write.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { SourceTree, createSourceRef, EvidenceError, resolveInsideRepo } from '../evidence/source.js';
import { createManifest, sectionsCitingEvidence } from './build.js';

/** @typedef {import('./types.js').Manifest} Manifest */

/** A draft or revised manifest that can't be turned into a manifest; `problems` says why, one line each. */
export class WorkflowError extends Error {
  /** @param {string} message @param {string[]} [problems] */
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}

const DRAFT_KEYS = ['feature', 'evidence', 'analysis', 'visualizations', 'sections', 'summary'];
const REQUIRED_DRAFT_KEYS = ['feature', 'evidence', 'analysis', 'sections', 'summary'];

/**
 * Where a feature's existing manifest.json is: `<outputDir>/<featureId>/manifest.json`,
 * resolved inside the repository (a symlink out of it is an error, not a
 * document). Nothing is read.
 *
 * @param {string} repoRoot
 * @param {string} outputDir as loaded by loadConfig
 * @param {string} featureId
 * @returns {{ path: string, found: boolean, real?: string, error?: string }}
 */
export function existingDocument(repoRoot, outputDir, featureId) {
  const rel = path.posix.join(outputDir, featureId, 'manifest.json');
  const real = resolveInsideRepo(fs.realpathSync(repoRoot), rel);
  if (typeof real === 'string') return { path: rel, found: true, real };
  // `invalid`: a feature id no document can have; validation reports it.
  if (real.reason === 'not-found' || real.reason === 'invalid') return { path: rel, found: false };
  return { path: rel, found: false, error: `cannot use ${rel}: ${real.error}` };
}

/**
 * Stamp every evidence entry that has no `snippetHash` with createSourceRef.
 * Entries that already have one are left as they are; validation checks
 * them against the repository like any other.
 *
 * @param {string} repoRoot
 * @param {unknown[]} evidence
 * @returns {{ evidence: object[], stamped: string[], warnings: string[] }}
 * @throws {WorkflowError} listing every entry whose file or lines don't exist
 */
export function stampEvidence(repoRoot, evidence) {
  const tree = new SourceTree(repoRoot);
  const problems = [];
  const warnings = [];
  const stamped = [];
  const out = evidence.map((ev, i) => {
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
      problems.push(`evidence ${i}: must be an object`);
      return ev;
    }
    if (ev.snippetHash !== undefined) return ev;
    const name = typeof ev.id === 'string' ? `"${ev.id}"` : String(i);
    try {
      const { ref, warnings: w } = createSourceRef(tree, ev);
      warnings.push(...w.map((x) => `evidence ${name}: ${x}`));
      stamped.push(ev.id);
      return ref;
    } catch (e) {
      if (!(e instanceof EvidenceError)) throw e;
      problems.push(`evidence ${name}: ${e.message}`);
      return ev;
    }
  });
  if (problems.length > 0) throw new WorkflowError(`${problems.length} evidence location(s) do not exist in the repository`, problems);
  return { evidence: out, stamped, warnings };
}

/**
 * Build a new manifest from a draft: `{ feature, evidence, analysis,
 * visualizations?, sections, summary }`, the parts of a manifest Claude
 * writes. Evidence locations are stamped here; repository and people
 * metadata come from the caller (git), never from the draft.
 *
 * @param {unknown} draft
 * @param {object} context
 * @param {string} context.repoRoot
 * @param {import('./types.js').Metadata['repository']} context.repository
 * @param {import('./types.js').Person} context.generatedBy
 * @param {import('./types.js').Contributor[]} [context.contributors]
 * @param {Date} [context.now]
 * @returns {{ manifest: Manifest, validation: import('../validation/validate.js').ValidationResult, warnings: string[] }}
 * @throws {WorkflowError} on a draft of the wrong shape or evidence that doesn't exist
 */
export function buildFromDraft(draft, { repoRoot, repository, generatedBy, contributors = [], now }) {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) throw new WorkflowError('the draft must be a JSON object');
  const problems = [
    ...Object.keys(draft).filter((k) => !DRAFT_KEYS.includes(k)).map((k) => `unknown key "${k}"; a draft has only ${DRAFT_KEYS.join(', ')}`),
    ...REQUIRED_DRAFT_KEYS.filter((k) => !(k in draft)).map((k) => `missing "${k}"`),
  ];
  if (draft.evidence !== undefined && !Array.isArray(draft.evidence)) problems.push('"evidence" must be an array');
  if (draft.sections !== undefined && !Array.isArray(draft.sections)) problems.push('"sections" must be an array');
  if (problems.length > 0) throw new WorkflowError('the draft has the wrong shape', problems);

  const { evidence, warnings } = stampEvidence(repoRoot, draft.evidence);
  const { manifest, validation } = createManifest({
    feature: draft.feature,
    repository,
    generatedBy,
    contributors,
    evidence,
    analysis: draft.analysis,
    visualizations: draft.visualizations,
    sections: draft.sections,
    summary: draft.summary,
    now,
    repoRoot,
  });
  return { manifest, validation, warnings };
}

/**
 * @typedef {object} UpdateChanges
 * @property {string[]} changedSections for recordUpdate, in manifest section order, then manual
 *   sections removed with `editManual`
 * @property {Record<string, string[]>} reasons why each changed section is included
 * @property {{ id: string, stale?: string, change: 'added' | 'removed' | 'edited' | 'unchanged' }[]} evidence
 *   evidence this update touches: `stale` is its status in the previous manifest (moved, changed,
 *   missing, ambiguous), `change` how the revised manifest differs from the previous one
 * @property {string[]} removedSections sections of the previous manifest that the revised one drops
 * @property {{ id: string, reasons: string[] }[]} manualToReview manual sections affected but not changed; tell the user
 */

/**
 * Work out what an update changes, comparing the existing manifest with the
 * revised copy Claude edited. Refuses what an update must not do: change
 * the feature id, touch the history, or change or remove a manual section
 * the user did not explicitly ask to edit (`editManual`).
 *
 * A section is in `changedSections` when it is new, its own content
 * changed, a finding placed in it or a visualization it lists changed, it
 * shows (by `sectionsCitingEvidence`) evidence the update touches, or, for
 * generated sections, the analysis data its kind lays out changed. The
 * `history` kind is not included: every update changes it.
 *
 * @param {Manifest} previous the existing manifest.json
 * @param {Manifest} revised the working copy, still carrying the previous history
 * @param {{ stale?: import('../validation/repository.js').StaleEntry[], editManual?: string[] }} [options]
 *   `stale`: the previous manifest's stale entries against the repository now
 * @returns {UpdateChanges}
 * @throws {WorkflowError} when the revision is not an update of `previous`
 */
export function planUpdate(previous, revised, { stale = [], editManual = [] } = {}) {
  const problems = [];
  const prevId = previous.metadata.feature.id;
  if (revised.metadata.feature.id !== prevId) {
    problems.push(`the feature id changed from "${prevId}" to "${revised.metadata.feature.id}"; build a new document for a new feature id instead`);
  }
  if (!isDeepStrictEqual(previous.history, revised.history)) {
    const ahead = revised.history.length > previous.history.length
      && previous.history.every((h, i) => isDeepStrictEqual(h, revised.history[i]));
    problems.push(ahead
      ? `the working copy already records ${revised.history.length - previous.history.length} update(s) after "${previous.history.at(-1).id}"; render it, or start again from the existing manifest.json`
      : 'the working copy\'s history differs from the existing manifest.json; start again from a copy of it and leave history unchanged');
  }

  const before = sectionMap(previous);
  const after = sectionMap(revised);
  const allowed = new Set(editManual);
  for (const id of editManual) {
    if (before.get(id)?.origin !== 'manual' && after.get(id)?.origin !== 'manual') {
      problems.push(`--edit-manual ${id}: there is no manual section "${id}"`);
    }
  }
  for (const [id, s] of before) {
    if (s.origin !== 'manual') continue;
    const now = after.get(id);
    if (now && isDeepStrictEqual(content(s), content(now))) continue;
    if (!allowed.has(id)) {
      problems.push(`manual section "${id}" was ${now ? 'changed' : 'removed'}; FeatureLens never changes manual sections unless the user asks. Restore it from the existing manifest.json, or pass --edit-manual ${id} if the user asked for this change`);
    }
  }
  for (const [id, s] of after) {
    if (s.origin === 'manual' && !before.has(id) && !allowed.has(id)) {
      problems.push(`manual section "${id}" is new; pass --edit-manual ${id} if the user asked to add it`);
    }
  }
  if (problems.length > 0) throw new WorkflowError('the working copy is not an update FeatureLens can record', problems);

  // Evidence touched: stale in the previous manifest, or different now.
  const staleStatus = new Map(stale.map((x) => [x.evidenceId, x.status]));
  const evBefore = new Map(previous.evidence.map((e) => [e.id, e]));
  const evAfter = new Map(revised.evidence.map((e) => [e.id, e]));
  const changeOf = (id) => {
    if (!evBefore.has(id)) return 'added';
    if (!evAfter.has(id)) return 'removed';
    return isDeepStrictEqual(evBefore.get(id), evAfter.get(id)) ? 'unchanged' : 'edited';
  };
  const touched = [...new Set([...staleStatus.keys(), ...evAfter.keys(), ...evBefore.keys()])]
    .filter((id) => staleStatus.has(id) || changeOf(id) !== 'unchanged');
  const evidence = touched.map((id) => ({ id, ...(staleStatus.has(id) ? { stale: staleStatus.get(id) } : {}), change: changeOf(id) }));
  const label = (id) => `${id} (${describeEvidence(staleStatus.get(id), changeOf(id))})`;

  /** @type {Map<string, string[]>} */
  const reasons = new Map();
  const why = (id, reason) => {
    if (!reasons.has(id)) reasons.set(id, []);
    if (!reasons.get(id).includes(reason)) reasons.get(id).push(reason);
  };
  const vizBefore = vizMap(previous);
  const vizAfter = vizMap(revised);

  for (const [id, s] of after) {
    const old = before.get(id);
    const generated = s.origin === 'generated';
    if (!old) why(id, 'new section');
    else if (!isDeepStrictEqual(content(old), content(s))) why(id, generated ? 'section content edited' : 'manual edit requested with --edit-manual');
    if (!generated && !reasons.has(id)) continue; // manual and untouched: reviewed below, never changed
    if (!isDeepStrictEqual(findingsIn(previous, id), findingsIn(revised, id))) why(id, 'findings placed here changed');
    for (const v of s.visualizations ?? []) {
      if (!isDeepStrictEqual(vizBefore.get(v), vizAfter.get(v))) why(id, `visualization ${v} changed`);
    }
    if (generated && Object.hasOwn(KIND_DATA, s.kind) && !isDeepStrictEqual(KIND_DATA[s.kind](previous), KIND_DATA[s.kind](revised))) {
      why(id, `${s.kind} analysis data changed`);
    }
  }

  // Sections showing touched evidence, in the previous or the revised manifest.
  /** @type {Map<string, Set<string>>} manual section id → touched evidence it shows */
  const manualCiting = new Map();
  for (const ev of touched) {
    for (const m of [previous, revised]) {
      const { generated, manual } = sectionsCitingEvidence(m, [ev]);
      for (const id of generated) if (after.get(id)?.origin === 'generated') why(id, `shows evidence ${label(ev)}`);
      for (const id of manual) {
        if (!manualCiting.has(id)) manualCiting.set(id, new Set());
        manualCiting.get(id).add(ev);
      }
    }
  }

  // Manual sections the update affects but must not change: the user decides.
  const manualToReview = [];
  for (const [id, s] of after) {
    if (s.origin !== 'manual' || reasons.has(id)) continue;
    const r = [];
    if (manualCiting.has(id)) r.push(`cites evidence ${[...manualCiting.get(id)].map(label).join(', ')}`);
    if (!isDeepStrictEqual(findingsIn(previous, id), findingsIn(revised, id))) r.push('findings placed here changed');
    for (const v of s.visualizations ?? []) if (!isDeepStrictEqual(vizBefore.get(v), vizAfter.get(v))) r.push(`visualization ${v} changed`);
    if (r.length > 0) manualToReview.push({ id, reasons: r });
  }

  // A manual section removed at the user's request is recorded too, so the
  // writer can tell it from a silent removal (it warns that the id is gone).
  const removedSections = [...before.keys()].filter((id) => !after.has(id));
  for (const id of removedSections) if (before.get(id).origin === 'manual') why(id, 'manual section removed with --edit-manual');
  const changedSections = [...after.keys(), ...removedSections].filter((id) => reasons.has(id));
  return {
    changedSections,
    reasons: Object.fromEntries(changedSections.map((id) => [id, reasons.get(id)])),
    evidence,
    removedSections,
    manualToReview,
  };
}

/** What a generated section of each kind lays out beyond its body and findings (src/render/render.js). */
const KIND_DATA = {
  overview: (m) => [m.metadata.feature.request, m.metadata.feature.proposedChange],
  scope: (m) => [m.analysis.scope, m.analysis.components],
  architecture: (m) => [m.analysis.components, m.analysis.relationships],
  implementation: (m) => [m.analysis.files],
  impact: (m) => [m.analysis.impact, m.analysis.components, m.analysis.relationships],
  risks: (m) => [m.analysis.risks],
  testing: (m) => [m.analysis.testing],
  unknowns: (m) => [m.analysis.unknowns],
  references: (m) => [m.evidence],
};

/** "moved; updated", "changed; not updated yet", "added", … */
export function describeEvidence(stale, change) {
  const now = { added: 'added', removed: 'removed', edited: 'updated', unchanged: 'not updated yet' }[change];
  return stale ? `${stale}; ${now}` : now;
}

const content = ({ provenance, ...rest }) => rest;
const sectionMap = (m) => new Map(m.documentation.sections.map((s) => [s.id, s]));
const findingsIn = (m, id) => m.analysis.findings.filter((f) => f.section === id);

function vizMap(m) {
  const out = new Map();
  for (const list of Object.values(m.visualizations ?? {})) for (const v of list ?? []) out.set(v.id, v);
  return out;
}
