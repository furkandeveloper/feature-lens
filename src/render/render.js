// Turns a manifest into one self-contained HTML document. Pure: no file
// I/O, no git, no network, no clock or randomness; the same manifest,
// inputs and options give the same bytes. It does not add the FeatureLens
// marker: output/writer's writeFeatureDocument stamps it
// (src/output/marker.js).
//
// The document is a small documentation app (src/render/layout.js): a
// sidebar, a top bar, and one page per section, plus an overview page
// (src/render/overview.js). The URL hash picks the page, with stylesheet
// rules only; there is no script for it. Sections keep manifest order in
// the document; the sidebar groups them by kind.
//
// Every dynamic value is escaped by `html` (src/render/escape.js). A
// Content-Security-Policy forbids loading anything. By default the
// document has no scripts. With `{ interactive: true }`, a document that
// draws an impact diagram also gets one constant script, allowed by its
// hash and nothing else (src/render/interactive.js, ARCHITECTURE.md
// §6.1.4). `{ mode }` picks the presentation (src/render/presentation.js):
// the same claims and evidence, worded and disclosed for developers or
// for product readers.

import { html, Html } from './escape.js';
import { indexInputs, RenderError } from './inputs.js';
import { buildImpactGraph } from '../analysis/impact-graph.js';
import { impactDiagram, architectureDiagram, DiagramError } from '../analysis/diagram-model.js';
import { executionFlowDiagram, sequenceDiagram, stateMachineDiagram, dataFlowDiagram } from '../analysis/flow-models.js';
import { diagram } from './diagram.js';
import { flowDiagram } from './flow-diagram.js';
import { IMPACT_SCRIPT, IMPACT_SCRIPT_HASH, INTERACTIVE_STYLE } from './interactive.js';
import { MODES, DEFAULT_MODE, CERTAINTY_MEANING, words } from './presentation.js';
import { claimHead, claimSources, certainty, refs, componentName, person, validation, disclose } from './claims.js';
import { groupOf, skipLinks, topbar, sidebar, pageWrap, pageStyle } from './layout.js';
import { overviewPage } from './overview.js';
import { STYLE } from './style.js';

export { RenderError, MODES, DEFAULT_MODE };

/** Section kinds and what a generated section of each kind shows beyond its body and findings. */
const KIND_CONTENT = {
  overview: (c) => overview(c),
  scope: (c) => scope(c),
  architecture: (c) => architecture(c),
  implementation: (c) => implementation(c),
  flows: () => null,
  impact: (c) => impact(c),
  risks: (c) => notes(c, c.manifest.analysis.risks, 'risk', 'No risks were recorded.'),
  testing: (c) => notes(c, c.manifest.analysis.testing, 'testing', 'No testing notes were recorded.'),
  unknowns: (c) => unknowns(c),
  references: (c) => evidenceCatalog(c),
  history: (c) => history(c),
  custom: () => null,
};

export const SECTION_KINDS = Object.freeze(Object.keys(KIND_CONTENT));

const VIZ_TYPES = {
  architecture: 'Architecture view',
  executionFlows: 'Execution flow',
  sequences: 'Sequence',
  stateMachines: 'State machine',
  dataFlows: 'Data flow',
};

/** How each visualization type is drawn: its diagram model (pure, from the manifest alone), then its SVG and text version. */
const VIZ_DRAW = {
  architecture: (c, v) => diagram(diagramModel(() => architectureDiagram(c.manifest, v)), diagramContext(c), { empty: 'This view has no nodes.' }),
  executionFlows: (c, v) => flowDiagram(diagramModel(() => executionFlowDiagram(c.manifest, v)), diagramContext(c)),
  sequences: (c, v) => flowDiagram(diagramModel(() => sequenceDiagram(c.manifest, v)), diagramContext(c)),
  stateMachines: (c, v) => flowDiagram(diagramModel(() => stateMachineDiagram(c.manifest, v)), diagramContext(c)),
  dataFlows: (c, v) => flowDiagram(diagramModel(() => dataFlowDiagram(c.manifest, v)), diagramContext(c)),
};

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
/** The same policy, plus the hash of the one script an interactive document carries. */
const CSP_INTERACTIVE = `default-src 'none'; script-src ${IMPACT_SCRIPT_HASH}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;

/**
 * @typedef {object} RenderOptions
 * @property {boolean} [interactive] enhance the impact diagram with a script (default false).
 *   A document without an impact diagram is the same either way.
 * @property {'developer' | 'product'} [mode] presentation (default 'developer'): labels and which
 *   details start collapsed. The claims, certainty and evidence shown are the same in both.
 */

/**
 * @param {import('../manifest/types.js').Manifest} manifest a manifest that passed checkWriteGate
 * @param {import('./inputs.js').RenderInputs} inputs
 * @param {RenderOptions} [options]
 * @returns {string} the document: `<!doctype html>` on line 1, no marker, ending with "\n"
 * @throws {RenderError} on an unknown section kind, inputs that contradict the manifest, or bad options
 */
export function render(manifest, inputs, options = {}) {
  const c = context(manifest, inputs, options);
  const { feature, repository } = manifest.metadata;
  const { sections } = manifest.documentation;

  // Sections are rendered before the overview page, which links to their
  // anchors, and before the head, which depends on whether one drew an
  // interactive diagram.
  const bodies = new Map(sections.map((s) => [s.id, section(c, s)]));
  const appendices = [
    !c.unknownsHome && { id: 'appendix-unknowns', title: 'Unknowns and limitations', group: 'quality', body: unknowns(c) },
    !c.evidenceHome && { id: 'appendix-evidence', title: c.mode === 'product' ? 'Sources' : 'Evidence', group: 'reference', body: evidenceCatalog(c) },
  ].filter(Boolean);
  c.diagramLinks = diagramLinks(c);
  c.diagramCount = c.diagramLinks.length;

  const pages = c.pages;
  let n = pages.length;
  for (const a of appendices) pages.push({ index: n++, group: a.group, title: a.title, href: `#${a.id}`, subs: [], appendix: a });
  const home = overviewPage(c, c.homeSectionId ? bodies.get(c.homeSectionId) : '');
  const content = pages.map((p) => {
    if (p.index === 0) return pageWrap(pages, p, home);
    if (p.appendix) {
      const a = p.appendix;
      return pageWrap(pages, p, html`<section id="${a.id}" class="appendix">
<div class="page-head">
<p class="eyebrow">${c.words.groups[a.group]}</p>
<h2>${a.title}</h2>
</div>
${a.body}
</section>
`);
    }
    return pageWrap(pages, p, bodies.get(p.sectionId));
  });

  const scripted = c.scripted;
  const style = STYLE + pageStyle(pages) + (scripted ? INTERACTIVE_STYLE : '');
  const doc = html`<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${scripted ? CSP_INTERACTIVE : CSP}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="FeatureLens ${manifest.metadata.tool.version}">
<title>${feature.name} · FeatureLens</title>
<style>${new Html(style)}</style>
</head>
<body class="mode-${c.mode}">
${skipLinks(pages)}${topbar(pages, { name: feature.name, repository: `${repository.name}${repository.branch ? ` · ${repository.branch}` : ''}`, view: c.words.view })}
<div class="shell">
${sidebar(pages, c.words.groups)}
<main>
${content}</main>
</div>
<footer>
<p>Generated by FeatureLens ${manifest.metadata.tool.version} from manifest.json at history entry <code>${c.lastHistory.id}</code> (schema ${manifest.schemaVersion}). manifest.json is the source of truth; this file is regenerated from it and should not be edited.</p>
</footer>
${scripted ? html`<script>${new Html(IMPACT_SCRIPT)}</script>
` : ''}</body>
</html>`;
  return `<!doctype html>\n${doc}\n`;
}

function context(manifest, inputs, options) {
  const { excerpts, stale } = indexInputs(manifest, inputs);
  const { interactive = false, mode = DEFAULT_MODE } = options ?? {};
  if (typeof interactive !== 'boolean') throw new RenderError('the interactive option must be true or false');
  if (!MODES.includes(mode)) throw new RenderError(`the mode option must be one of ${MODES.join(', ')}`);
  const sections = manifest.documentation.sections;
  for (const s of sections) {
    if (!Object.hasOwn(KIND_CONTENT, s.kind)) throw new RenderError(`section "${s.id}" has unsupported kind "${s.kind}"`);
  }
  const vizs = new Map();
  for (const [type, label] of Object.entries(VIZ_TYPES)) {
    for (const v of manifest.visualizations[type] ?? []) vizs.set(v.id, { type, label, v });
  }
  const firstGenerated = (kind) => sections.find((s) => s.kind === kind && s.origin === 'generated')?.id ?? null;
  // The overview page embeds the first section when it is an overview; every other section is a page of its own.
  const homeSectionId = sections[0]?.kind === 'overview' ? sections[0].id : null;
  const home = homeSectionId ? [{ href: `#section-${homeSectionId}`, label: sections[0].title, tag: 'Summary' }] : [];
  const pages = [{ index: 0, group: 'overview', title: 'Overview', href: '#page-0', subs: home, sectionId: homeSectionId }];
  for (const s of sections) {
    if (s.id === homeSectionId) continue;
    pages.push({ index: pages.length, group: groupOf(s.kind), title: s.title, href: `#section-${s.id}`, subs: [], sectionId: s.id, manual: s.origin === 'manual' });
  }
  const evidenceHome = firstGenerated('references');
  const unknownsHome = firstGenerated('unknowns');
  return {
    manifest,
    excerpts,
    stale,
    mode,
    words: words(mode),
    evidence: new Map(manifest.evidence.map((e) => [e.id, e])),
    components: new Map(manifest.analysis.components.map((x) => [x.id, x])),
    history: new Map(manifest.history.map((h) => [h.id, h])),
    lastHistory: manifest.history.at(-1),
    vizs,
    pages,
    homeSectionId,
    sectionTitles: new Map(sections.map((s) => [s.id, s.title])),
    /** The page each section is on. */
    pageOf: new Map(pages.filter((p) => p.sectionId).map((p) => [p.sectionId, p])),
    /** Anchor keys ("evidence:<id>", "viz:<id>", …) already given to an element, so each id is used once. */
    anchored: new Set(),
    /** Visualization id → its anchor, for those a section shows. */
    vizHref: new Map(),
    interactive,
    /** Set once an interactive impact diagram is drawn: the page then carries the script. */
    scripted: false,
    /** Set once a generated impact section draws its diagram. */
    impactDrawn: false,
    // Evidence anchors and the unknowns list live in the first generated
    // section of their kind, or in an appendix when there is none.
    evidenceHome,
    unknownsHome,
    evidenceHref: evidenceHome ? `#section-${evidenceHome}` : '#appendix-evidence',
    unknownsHref: unknownsHome ? `#section-${unknownsHome}` : '#appendix-unknowns',
    hrefOfKind: (kind) => {
      const id = firstGenerated(kind);
      return id ? `#section-${id}` : null;
    },
  };
}

/** Claims an element's anchor id once; later copies get none. */
function anchor(c, key) {
  if (c.anchored.has(key)) return false;
  c.anchored.add(key);
  return true;
}

function section(c, s) {
  const generated = s.origin === 'generated';
  const findings = c.manifest.analysis.findings.filter((f) => f.section === s.id);
  const content = generated ? KIND_CONTENT[s.kind](c) : null;
  const page = c.pageOf.get(s.id);
  const home = s.id === c.homeSectionId;
  return html`<section id="section-${s.id}" class="${generated ? 'generated' : 'manual'} kind-${s.kind}">
<div class="page-head">
${home ? '' : html`<p class="eyebrow">${c.words.groups[groupOf(s.kind)]}</p>
`}<h2>${s.title}</h2>
<p class="provenance">${generated
  ? html`<span class="badge generated">generated</span> Written by FeatureLens from the analysis; regenerated on update.`
  : html`<span class="badge manual">manual</span> Written by a person; FeatureLens never rewrites it.`} ${provenance(c, s.provenance.historyId)}</p>
</div>
${s.body !== undefined ? html`<div class="body prose">${s.body}</div>
` : ''}${s.sourceRefs?.length ? claimSources(c, s.sourceRefs) : ''}${findings.length ? html`${home ? '' : html`<h3 class="list-title">${c.words.findings}</h3>
`}<ul class="claims findings">
${findings.map((f) => html`<li id="finding-${f.id}">${claimHead(c, f, f.title)}<div class="body">${f.body}</div>${claimSources(c, f.evidence, { certaintyOf: f.certainty })}</li>
`)}</ul>
` : ''}${(s.visualizations ?? []).map((id) => visualization(c, id, page))}${content ? html`${content}
` : ''}</section>
`;
}

function provenance(c, historyId) {
  const h = c.history.get(historyId);
  if (!h) return html`Last changed in history entry <code>${historyId}</code>.`;
  return html`Last changed in <code>${h.id}</code> (${h.action}, ${h.at}, by ${person(h.by)}).`;
}

function overview(c) {
  const { feature } = c.manifest.metadata;
  return html`<dl class="meta request">
<dt>Request</dt><dd class="body">${feature.request}</dd>
${feature.proposedChange ? html`<dt>Proposed change</dt><dd class="body">${feature.proposedChange}</dd>
` : ''}</dl>`;
}

function scope(c) {
  const { scope: sc } = c.manifest.analysis;
  const list = (items, empty) => (items.length ? html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>` : html`<p class="empty">${empty}</p>`);
  return html`<div class="body prose">${sc.summary}</div>
<div class="scope-cols">
<div class="scope-col in-scope">
<h3>In scope</h3>
${list(sc.inScope, 'Nothing listed.')}
</div>
<div class="scope-col out-scope">
<h3>Out of scope</h3>
${list(sc.outOfScope, 'Nothing listed.')}
</div>
</div>
${sc.entryPoints?.length ? html`<h3>Entry points</h3>
${list(sc.entryPoints.map((id) => componentName(c, id)), '')}` : ''}`;
}

function architecture(c) {
  const { components, relationships } = c.manifest.analysis;
  const product = c.mode === 'product';
  const componentList = components.length ? html`<ul class="claims components">
${components.map((x) => {
    const id = anchor(c, `component:${x.id}`);
    const detail = html`${x.parent ? html`<p class="detail">Part of ${componentName(c, x.parent)}</p>` : ''}${x.endpoint
      ? html`<p class="detail">Endpoint: <code>${x.endpoint.method ? `${x.endpoint.method} ` : ''}${x.endpoint.path}</code> (${x.endpoint.protocol})</p>`
      : ''}${x.dependency
      ? html`<p class="detail">Dependency: <code>${x.dependency.name}${x.dependency.version ? `@${x.dependency.version}` : ''}</code>${x.dependency.ecosystem ? ` (${x.dependency.ecosystem})` : ''}</p>`
      : ''}`;
    if (product) {
      return html`<li${id ? html` id="component-${x.id}"` : ''}><p class="claim-head">${x.name}</p><div class="body">${x.summary}</div><details class="tech"><summary>Technical details</summary>
<p class="detail">Kind: ${x.kind}. Certainty: <strong>${x.certainty}</strong>. ${CERTAINTY_MEANING[x.certainty] ?? ''}</p>${detail}${x.evidence?.length ? html`<p class="sources">${refs(c, x.evidence)}</p>` : ''}
</details></li>
`;
    }
    return html`<li${id ? html` id="component-${x.id}"` : ''}>${claimHead(c, x, html`${x.name} <span class="kind">${x.kind}</span>`)}${detail}<div class="body">${x.summary}</div>${claimSources(c, x.evidence)}</li>
`;
  })}</ul>` : html`<p class="empty">No components were recorded.</p>`;
  const relationshipList = relationships.length ? html`<ul class="claims relationships">
${relationships.map((r) => html`<li>${claimHead(c, r, html`${componentName(c, r.from)} <span class="kind">${r.kind}</span> ${componentName(c, r.to)}`)}${r.label ? html`<div class="body">${r.label}</div>` : ''}${claimSources(c, r.evidence, { certaintyOf: r.certainty })}</li>
`)}</ul>` : html`<p class="empty">No relationships were recorded.</p>`;
  return html`<h3>${c.words.components}</h3>
${componentList}
${disclose(c, `${c.words.relationships} (${relationships.length})`, relationshipList, { open: !product || !relationships.length })}`;
}

function implementation(c) {
  const { files } = c.manifest.analysis;
  if (!files.length) return html`<p class="empty">No relevant files were recorded.</p>`;
  const list = html`<ul class="files">
${files.map((f) => html`<li><code>${f.path}</code> <span class="kind">${f.role}</span><div class="body">${f.reason}</div>${f.evidence?.length ? html`<p class="sources">Sources: ${refs(c, f.evidence)}</p>` : ''}</li>
`)}</ul>`;
  return disclose(c, c.mode === 'product' ? `${c.words.files} (${files.length})` : c.words.files, list);
}

function impact(c) {
  const { impact: imp } = c.manifest.analysis;
  const items = new Map(imp.items.map((i) => [i.id, i]));
  const itemName = (id) => {
    const i = items.get(id);
    return i ? itemTarget(c, i) : html`<code>${id}</code>`;
  };
  const graph = buildImpactGraph(c.manifest);
  const derived = graph.nodes.filter((n) => n.indirect && !n.impact);
  const product = c.mode === 'product';
  const declared = imp.relationships.length ? html`<ul class="claims">
${imp.relationships.map((r) => html`<li>${claimHead(c, r, html`${itemName(r.from)} → ${itemName(r.to)}`)}${claimSources(c, r.evidence, { certaintyOf: r.certainty })}<div class="body">${r.reason}</div></li>
`)}</ul>` : html`<p class="empty">No impact relationships were recorded.</p>`;
  const derivedList = html`<p class="derived-note"><span class="badge derived">derived</span> Not a claim of the analysis and not backed by evidence: FeatureLens lists components that depend, directly or through other components, on something directly impacted, following the declared relationships.</p>
${derived.length ? html`<ul class="impact-derived">
${derived.map((n) => html`<li><span class="badge derived">derived</span> ${n.label} <span class="kind">${n.kind}</span></li>
`)}</ul>` : html`<p class="empty">No component depends on a directly impacted one.</p>`}`;
  return html`${imp.summary ? html`<div class="body prose">${imp.summary}</div>
` : ''}<h3>Impact diagram</h3>
${impactFigure(c)}
<h3>Direct impact</h3>
${imp.items.length ? html`<ul class="claims impact-direct">
${imp.items.map((i) => html`<li>${claimHead(c, i, html`${itemTarget(c, i)} <span class="badge level-${i.level}">${i.level}</span> <span class="kind">${i.change}</span>`)}${claimSources(c, i.evidence, { certaintyOf: i.certainty })}<div class="body">${i.reason}</div></li>
`)}</ul>` : html`<p class="empty">No impact items were recorded.</p>`}
${product ? disclose(c, `Declared impact relationships (${imp.relationships.length})`, declared, { open: false }) : html`<h3>Declared impact relationships</h3>
${declared}`}
${product ? disclose(c, `Derived (indirect) impact (${derived.length})`, derivedList, { open: false }) : html`<h3>Derived (indirect) impact</h3>
${derivedList}`}`;
}

/** The impact diagram; in an interactive document, wrapped for the script when there is something to draw. */
function impactFigure(c) {
  const model = diagramModel(() => impactDiagram(c.manifest));
  const empty = 'Nothing to draw: no impact items were recorded.';
  if (model.nodes.length > 0) c.impactDrawn = true;
  const ctx = diagramContext(c, { figure: false });
  if (!c.interactive || model.nodes.length === 0) return diagram(model, ctx, { empty });
  c.scripted = true;
  return html`<div class="impact-graph">
${diagram(model, ctx, { empty, interactive: true })}
</div>`;
}

function itemTarget(c, i) {
  const parts = [];
  if (i.componentId) parts.push(componentName(c, i.componentId));
  if (i.file) parts.push(html`<code>${i.file}</code>`);
  return html`${parts.map((p, n) => html`${n ? ' · ' : ''}${p}`)}`;
}

/** Risks and testing notes: severity first, then the title, the explanation and what backs it. */
function notes(c, list, prefix, empty) {
  if (!list.length) return html`<p class="empty">${empty}</p>`;
  return html`<ul class="claims notes notes-${prefix}">
${list.map((n) => {
    const id = anchor(c, `${prefix}:${n.id}`);
    return html`<li${id ? html` id="${prefix}-${n.id}"` : ''} class="note${n.severity ? ` severity-${n.severity}` : ''}"><p class="claim-head">${n.severity ? html`<span class="badge level-${n.severity}">${n.severity}${prefix === 'risk' ? ' severity' : ''}</span> ` : ''}${n.title}</p><div class="body">${n.body}</div><p class="note-foot">${certainty(c, n.certainty)}${c.mode === 'developer' && n.evidence?.length ? html` ${claimSourcesInline(c, n.evidence)}` : ''}</p>${c.mode === 'product' ? claimSources(c, n.evidence, { certaintyOf: n.certainty }) : ''}</li>
`;
  })}</ul>`;
}

function claimSourcesInline(c, ids) {
  return html`<span class="sources"><span class="sources-label">Sources</span> ${refs(c, ids)}</span>`;
}

function unknowns(c) {
  const list = c.manifest.analysis.unknowns;
  if (!list.length) return html`<p class="empty">No unknowns or limitations were recorded.</p>`;
  return html`<ul class="claims unknowns">
${list.map((u) => {
    const id = anchor(c, `unknown:${u.id}`);
    return html`<li${id ? html` id="unknown-${u.id}"` : ''} class="unknown-${u.kind}"><p class="claim-head"><span class="badge unknown">${c.words.unknownKind[u.kind] ?? u.kind}</span> ${u.statement}</p><p class="why"><span class="why-label">${u.kind === 'limitation' ? 'Why it is limited' : 'Why it is unknown'}</span> <span class="body">${u.reason}</span></p>${u.evidence?.length ? claimSources(c, u.evidence) : ''}</li>
`;
  })}</ul>`;
}

function history(c) {
  const table = html`<div class="table-scroll">
<table>
<thead><tr><th scope="col">Entry</th><th scope="col">When</th><th scope="col">By</th><th scope="col">Summary</th><th scope="col">Revision</th><th scope="col">Changed</th><th scope="col">Validation</th></tr></thead>
<tbody>
${c.manifest.history.map((h) => html`<tr><td><code>${h.id}</code> ${h.action}</td><td>${h.at}</td><td>${person(h.by)} <span class="detail">FeatureLens ${h.toolVersion}</span></td><td class="body">${h.summary}</td><td>${h.previousRevision ? html`<code>${h.previousRevision}</code> → ` : ''}${h.revision ? html`<code>${h.revision}</code>` : '—'}</td><td>${h.changedSections.length ? html`Sections: ${h.changedSections.map((s, n) => html`${n ? ', ' : ''}<code>${s}</code>`)}` : ''}${h.changedFiles.length ? html`<br>Files: ${h.changedFiles.map((f, n) => html`${n ? ', ' : ''}<code>${f}</code>`)}` : ''}</td><td>${validation(h.validation)}</td></tr>
`)}</tbody>
</table>
</div>`;
  return c.mode === 'product' ? disclose(c, `All history entries (${c.manifest.history.length})`, table, { open: false }) : table;
}

/**
 * Every evidence entry, grouped by file (files in order of first citation,
 * entries by line), each with its current code, or why it is not shown.
 */
function evidenceCatalog(c) {
  if (!c.manifest.evidence.length) return html`<p class="empty">No source evidence is cited.</p>`;
  const files = new Map();
  for (const ev of c.manifest.evidence) files.set(ev.file, [...(files.get(ev.file) ?? []), ev]);
  const staleCount = c.manifest.evidence.filter((e) => c.stale.has(e.id)).length;
  return html`<p class="detail evidence-intro">${c.manifest.evidence.length} cited location(s) in ${files.size} file(s)${staleCount ? html`, <span class="badge unverified">${staleCount} unverified</span>` : ''}. Each claim links here; your browser's Back button returns to the claim.</p>
${[...files].map(([file, list]) => html`<div class="evidence-file">
<h3 class="evidence-path"><code>${file}</code> <span class="kind">${list.length} location(s)</span></h3>
${[...list].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine).map((ev) => evidenceEntry(c, ev))}</div>
`)}`;
}

function evidenceEntry(c, ev) {
  const s = c.stale.get(ev.id);
  const x = c.excerpts.get(ev.id);
  let state;
  if (s) {
    state = html`<p class="stale"><span class="badge unverified">unverified: ${s.status}</span> ${s.message}</p>
<p class="detail">Needed: ${s.action}.${s.movedTo ? html` The same lines now appear at ${s.movedTo.startLine}-${s.movedTo.endLine}.` : ''}${s.candidates?.length ? html` The same lines appear at ${s.candidates.map((r, n) => html`${n ? ', ' : ''}${r.startLine}-${r.endLine}`)}.` : ''}</p>
<p class="detail">${s.manualOnly
  ? html`Cited only by manual section(s) ${s.manualSections.map((id, n) => html`${n ? ', ' : ''}<code>${id}</code>`)}; accepted for review, since FeatureLens never rewrites manual content.`
  : html`Cited by generated claims; they have not been re-checked against the current code.`} The code is not shown because it no longer matches.</p>`;
  } else if (x) {
    const code = html`<pre class="excerpt"><code>${x.text.split('\n').map((line, n) => html`${n ? '\n' : ''}<span class="ln">${ev.startLine + n}</span>${line}`)}</code></pre>`;
    state = html`<p class="current"><span class="badge current">current</span> Matches the stamped snippet hash.</p>
${c.mode === 'product' ? html`<details class="code"><summary>Show code (lines ${ev.startLine}-${ev.endLine})</summary>
${code}
</details>` : code}`;
  } else {
    state = html`<p class="detail"><span class="badge missing">no excerpt</span> No source excerpt was supplied for this reference.</p>`;
  }
  const id = anchor(c, `evidence:${ev.id}`);
  return html`<article class="evidence${s ? ' is-stale' : ''}"${id ? html` id="evidence-${ev.id}"` : ''}>
<h4><code>${ev.file}:${ev.startLine}-${ev.endLine}</code>${ev.symbol ? html` <span class="ref-sym"><code>${ev.symbol}</code></span>` : ''}</h4>
<p class="detail"><code>${ev.id}</code> · ${ev.kind} · confidence ${ev.confidence}${ev.symbol ? html` · symbol <code>${ev.symbol}</code>` : ''}${ev.revision ? html` · revision <code>${ev.revision}</code>` : ''}</p>
<div class="body">${ev.explanation}</div>
${state}
</article>
`;
}

function visualization(c, id, page) {
  const found = c.vizs.get(id);
  if (!found) return html`<p class="empty">Visualization <code>${id}</code> is not in the manifest.</p>\n`;
  const anchored = anchor(c, `viz:${id}`);
  if (anchored) {
    c.vizHref.set(id, `#viz-${id}`);
    page?.subs.push({ href: `#viz-${id}`, label: found.v.title, tag: found.label, diagram: true });
  }
  return html`${anchored ? html`<span class="anchor" id="viz-${id}"></span>
` : ''}<figure class="viz">
<figcaption>${found.v.title} <span class="kind">${found.label}</span></figcaption>
${found.v.description ? html`<div class="body">${found.v.description}</div>
` : ''}${VIZ_DRAW[found.type](c, found.v)}
</figure>
`;
}

/** The overview page's list of diagrams: every one a section shows, in document order, and the impact diagram. */
function diagramLinks(c) {
  const links = c.pages.flatMap((p) => p.subs.filter((s) => s.diagram));
  const impactSection = c.manifest.documentation.sections.find((s) => s.kind === 'impact' && s.origin === 'generated');
  if (impactSection && c.impactDrawn) links.push({ href: `#section-${impactSection.id}`, label: impactSection.title, tag: 'Impact diagram' });
  return links;
}

/** Diagram models come from the manifest alone; one that doesn't hold together is a render error, never a partial diagram. */
function diagramModel(build) {
  try {
    return build();
  } catch (e) {
    if (e instanceof DiagramError) throw new RenderError(e.message);
    throw e;
  }
}

/**
 * Text versions of visualizations start collapsed in both views; the impact
 * diagram's stays open in the developer view, next to the lists it summarizes.
 */
function diagramContext(c, { figure = true } = {}) {
  return { sources: (ids) => refs(c, ids), isStale: (id) => c.stale.has(id), collapseText: figure || c.mode === 'product' };
}
