// Checks JSON Schema cannot express: unique ids, cross-references, evidence
// rules for each certainty level, graph integrity and section provenance.
// Runs only on manifests that already passed schema validation.

import { uniqueIds } from './report.js';
import { checkVisualizations } from './visualizations.js';
import { checkHistory } from './history.js';

const EVIDENCE_REQUIRED = new Set(['observed', 'inferred']);

/**
 * @typedef {object} Context
 * @property {import('./report.js').Report} report
 * @property {Citations} citations who cites each evidence id
 * @property {(item: { certainty?: string, evidence?: string[] }, path: string) => void} claim
 * @property {(set: Set<string>, id: string, path: string, what: string) => boolean} ref
 * @property {{ evidence: Set<string>, components: Set<string>, relationships: Set<string> }} ids
 * @property {any} manifest
 */

/**
 * Where an evidence id is cited: the JSON Pointer of the citing claim or
 * section. `section` is set only for a section's own `sourceRefs`. A finding
 * placed in a section is still a generated claim, so it never makes evidence
 * count as manual.
 * @typedef {{ pointer: string, section?: string }} Citation
 * @typedef {Map<string, Citation[]>} Citations
 */

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('./report.js').Report} report
 * @returns {Citations}
 */
export function checkSemantics(manifest, report) {
  const { metadata, analysis } = manifest;
  /** @type {Citations} */
  const citations = new Map();
  const cite = (id, citation) => citations.set(id, [...(citations.get(id) ?? []), citation]);

  const ids = {
    evidence: uniqueIds(manifest.evidence, '/evidence', report),
    components: uniqueIds(analysis.components, '/analysis/components', report),
    relationships: uniqueIds(analysis.relationships, '/analysis/relationships', report),
  };

  /** @type {Context} */
  const ctx = {
    report,
    citations,
    ids,
    manifest,
    ref(set, id, path, what) {
      if (set.has(id)) return true;
      report.error('ref.unknown', path, `unknown ${what} id "${id}"`);
      return false;
    },
    claim(item, path) {
      for (const [i, id] of (item.evidence ?? []).entries()) {
        cite(id, { pointer: path });
        ctx.ref(ids.evidence, id, `${path}/evidence/${i}`, 'evidence');
      }
      if (EVIDENCE_REQUIRED.has(item.certainty) && !(item.evidence?.length > 0)) {
        report.error('evidence.required', `${path}/evidence`, `certainty "${item.certainty}" requires at least one evidence reference`);
      }
    },
  };

  const feature = metadata.feature;
  if (feature.mode === 'change-impact' && !feature.proposedChange?.trim()) {
    report.error('feature.proposed-change', '/metadata/feature/proposedChange', 'required when mode is "change-impact"');
  }

  checkAnalysis(analysis, ctx);
  const vizIds = checkVisualizations(manifest.visualizations, ctx);
  const historyIds = checkHistory(manifest, report);
  checkDocumentation(manifest, ctx, { vizIds, historyIds }, cite);
  checkEvidence(manifest, ctx);
  return citations;
}

/** @param {any} analysis @param {Context} ctx */
function checkAnalysis(analysis, ctx) {
  const { report, ids } = ctx;
  const base = '/analysis';

  uniqueIds(analysis.files, `${base}/files`, report, 'path');
  analysis.files.forEach((f, i) => ctx.claim(f, `${base}/files/${i}`));

  (analysis.scope.entryPoints ?? []).forEach((id, i) => ctx.ref(ids.components, id, `${base}/scope/entryPoints/${i}`, 'component'));

  analysis.components.forEach((c, i) => {
    const p = `${base}/components/${i}`;
    ctx.claim(c, p);
    if (c.parent !== undefined) ctx.ref(ids.components, c.parent, `${p}/parent`, 'component');
    if (c.endpoint && c.kind !== 'endpoint') {
      report.error('component.detail-mismatch', `${p}/endpoint`, `only allowed on components of kind "endpoint", not "${c.kind}"`);
    }
    if (c.dependency && c.kind !== 'external') {
      report.error('component.detail-mismatch', `${p}/dependency`, `only allowed on components of kind "external", not "${c.kind}"`);
    }
  });
  checkParentCycles(analysis.components, report);

  const edges = new Set();
  analysis.relationships.forEach((r, i) => {
    const p = `${base}/relationships/${i}`;
    ctx.claim(r, p);
    ctx.ref(ids.components, r.from, `${p}/from`, 'component');
    ctx.ref(ids.components, r.to, `${p}/to`, 'component');
    if (r.from === r.to) report.warn('graph.self-loop', p, `relationship "${r.id}" connects "${r.from}" to itself`);
    const key = `${r.from}\0${r.to}\0${r.kind}`;
    if (edges.has(key)) report.warn('graph.duplicate-edge', p, `another "${r.kind}" relationship already connects "${r.from}" to "${r.to}"`);
    edges.add(key);
  });

  const findingsPath = `${base}/findings`;
  uniqueIds(analysis.findings, findingsPath, report);
  analysis.findings.forEach((f, i) => ctx.claim(f, `${findingsPath}/${i}`));

  const impact = analysis.impact;
  const itemIds = uniqueIds(impact.items, `${base}/impact/items`, report);
  impact.items.forEach((item, i) => {
    const p = `${base}/impact/items/${i}`;
    ctx.claim(item, p);
    if (item.componentId !== undefined) ctx.ref(ids.components, item.componentId, `${p}/componentId`, 'component');
    if (item.componentId === undefined && item.file === undefined) {
      report.error('impact.missing-target', p, 'impact item must name a componentId, a file, or both');
    }
  });
  uniqueIds(impact.relationships, `${base}/impact/relationships`, report);
  impact.relationships.forEach((r, i) => {
    const p = `${base}/impact/relationships/${i}`;
    ctx.claim(r, p);
    ctx.ref(itemIds, r.from, `${p}/from`, 'impact item');
    ctx.ref(itemIds, r.to, `${p}/to`, 'impact item');
    if (r.from === r.to) report.warn('graph.self-loop', p, `impact relationship "${r.id}" connects "${r.from}" to itself`);
  });

  for (const key of ['risks', 'testing', 'unknowns']) {
    uniqueIds(analysis[key], `${base}/${key}`, report);
    analysis[key].forEach((item, i) => ctx.claim(item, `${base}/${key}/${i}`));
  }
}

/** A component's parent chain must end; report each component that sits on a cycle once. */
function checkParentCycles(components, report) {
  const parentOf = new Map(components.map((c) => [c.id, c.parent]));
  const indexOf = new Map(components.map((c, i) => [c.id, i]));
  const reported = new Set();
  for (const c of components) {
    const chain = [];
    let id = c.id;
    while (id !== undefined && parentOf.has(id) && !chain.includes(id)) {
      chain.push(id);
      id = parentOf.get(id);
    }
    if (id === undefined || !chain.includes(id)) continue;
    const cycle = chain.slice(chain.indexOf(id));
    const first = cycle.find((x) => !reported.has(x));
    if (first === undefined) continue;
    cycle.forEach((x) => reported.add(x));
    report.error('graph.parent-cycle', `/analysis/components/${indexOf.get(first)}/parent`, `parent chain forms a cycle: ${[...cycle, id].join(' → ')}`);
  }
}

/** @param {any} manifest @param {Context} ctx */
function checkDocumentation(manifest, ctx, { vizIds, historyIds }, cite) {
  const { report } = ctx;
  const sections = manifest.documentation.sections;
  const sectionIds = uniqueIds(sections, '/documentation/sections', report);
  const historyById = new Map(manifest.history.map((h) => [h.id, h]));

  const findingsPerSection = new Map();
  manifest.analysis.findings.forEach((f, i) => {
    if (!sectionIds.has(f.section)) {
      report.error('section.unknown', `/analysis/findings/${i}/section`, `unknown section id "${f.section}"`);
    }
    findingsPerSection.set(f.section, (findingsPerSection.get(f.section) ?? 0) + 1);
  });

  sections.forEach((s, i) => {
    const p = `/documentation/sections/${i}`;
    (s.sourceRefs ?? []).forEach((id, j) => {
      cite(id, { pointer: p, section: s.id });
      ctx.ref(ctx.ids.evidence, id, `${p}/sourceRefs/${j}`, 'evidence');
    });
    (s.visualizations ?? []).forEach((id, j) => ctx.ref(vizIds, id, `${p}/visualizations/${j}`, 'visualization'));

    const historyId = s.provenance.historyId;
    if (ctx.ref(historyIds, historyId, `${p}/provenance/historyId`, 'history')
        && !historyById.get(historyId).changedSections.includes(s.id)) {
      report.error('section.provenance', `${p}/provenance/historyId`,
        `history entry "${historyId}" does not list section "${s.id}" in changedSections`);
    }

    if (s.origin === 'manual') {
      if (s.body === undefined) report.error('section.manual-body', `${p}/body`, 'manual sections must have a body');
      if (findingsPerSection.has(s.id)) {
        report.warn('section.manual-findings', p, `manual section "${s.id}" has generated findings; updates may rewrite them`);
      }
    }
  });

  manifest.history.forEach((h, i) => h.changedSections.forEach((id, j) => {
    if (!sectionIds.has(id)) {
      report.warn('history.unknown-section', `/history/${i}/changedSections/${j}`, `section "${id}" no longer exists`);
    }
  }));
}

/** @param {any} manifest @param {Context} ctx */
function checkEvidence(manifest, ctx) {
  const { report } = ctx;
  const repoRevision = manifest.metadata.repository.revision;
  const listedFiles = new Set(manifest.analysis.files.map((f) => f.path));

  manifest.evidence.forEach((ev, i) => {
    const p = `/evidence/${i}`;
    if (ev.endLine < ev.startLine) report.error('evidence.range', `${p}/endLine`, 'must be >= startLine');
    if (!ctx.citations.has(ev.id)) report.warn('evidence.uncited', p, `evidence "${ev.id}" is never cited`);
    if (ev.revision && repoRevision && ev.revision !== repoRevision) {
      report.warn('evidence.revision', `${p}/revision`, `read at ${ev.revision}, but the analysis is at ${repoRevision}; line numbers may have moved`);
    }
    if (!listedFiles.has(ev.file)) {
      report.warn('evidence.unlisted-file', `${p}/file`, `${ev.file} is cited but not listed in analysis.files`);
    }
  });
}
