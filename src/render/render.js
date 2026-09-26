// Turns a manifest into one self-contained HTML document. Pure: no file
// I/O, no git, no network, no clock or randomness; the same manifest and
// inputs give the same bytes. It does not add the FeatureLens marker:
// output/writer's writeFeatureDocument stamps it (src/output/marker.js).
//
// Everything is rendered in manifest order. Every dynamic value is escaped
// by `html` (src/render/escape.js). A Content-Security-Policy forbids
// loading anything. By default the document has no scripts. With
// `{ interactive: true }`, a document that draws an impact diagram also
// gets one constant script, allowed by its hash and nothing else
// (src/render/interactive.js, ARCHITECTURE.md §6.1.4).

import { html, Html } from './escape.js';
import { indexInputs, RenderError } from './inputs.js';
import { buildImpactGraph } from '../analysis/impact-graph.js';
import { impactDiagram, architectureDiagram, DiagramError } from '../analysis/diagram-model.js';
import { executionFlowDiagram, sequenceDiagram, stateMachineDiagram, dataFlowDiagram } from '../analysis/flow-models.js';
import { diagram } from './diagram.js';
import { flowDiagram } from './flow-diagram.js';
import { IMPACT_SCRIPT, IMPACT_SCRIPT_HASH, INTERACTIVE_STYLE } from './interactive.js';

export { RenderError };

/** Section kinds and what a generated section of each kind shows beyond its body and findings. */
const KIND_CONTENT = {
  overview: (c) => overview(c),
  scope: (c) => scope(c),
  architecture: (c) => architecture(c),
  implementation: (c) => implementation(c),
  flows: () => null,
  impact: (c) => impact(c),
  risks: (c) => notes(c, c.manifest.analysis.risks, 'No risks were recorded.'),
  testing: (c) => notes(c, c.manifest.analysis.testing, 'No testing notes were recorded.'),
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
  const { feature } = manifest.metadata;
  const appendices = [
    !c.unknownsHome && { id: 'appendix-unknowns', title: 'Unknowns and limitations', body: unknowns(c) },
    !c.evidenceHome && { id: 'appendix-evidence', title: 'Evidence', body: evidenceCatalog(c) },
  ].filter(Boolean);
  // Sections are rendered before the head, which depends on whether one drew an interactive diagram.
  const sections = manifest.documentation.sections.map((s) => section(c, s));
  const scripted = c.scripted;

  const doc = html`<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${scripted ? CSP_INTERACTIVE : CSP}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="FeatureLens ${manifest.metadata.tool.version}">
<title>${feature.name} · FeatureLens</title>
<style>${new Html(scripted ? STYLE + INTERACTIVE_STYLE : STYLE)}</style>
</head>
<body>
<header>
<h1>${feature.name}</h1>
${header(c)}
</header>
<nav aria-label="Contents">
<h2>Contents</h2>
<ol>
${manifest.documentation.sections.map((s) => html`<li><a href="#section-${s.id}">${s.title}</a>${s.origin === 'manual' ? html` <span class="badge manual">manual</span>` : ''}</li>
`)}${appendices.map((a) => html`<li><a href="#${a.id}">${a.title}</a></li>
`)}</ol>
</nav>
<main>
${sections}${appendices.map((a) => html`<section id="${a.id}" class="appendix">
<h2>${a.title}</h2>
${a.body}
</section>
`)}</main>
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
  const { interactive = false } = options ?? {};
  if (typeof interactive !== 'boolean') throw new RenderError('the interactive option must be true or false');
  const sections = manifest.documentation.sections;
  for (const s of sections) {
    if (!Object.hasOwn(KIND_CONTENT, s.kind)) throw new RenderError(`section "${s.id}" has unsupported kind "${s.kind}"`);
  }
  const vizs = new Map();
  for (const [type, label] of Object.entries(VIZ_TYPES)) {
    for (const v of manifest.visualizations[type] ?? []) vizs.set(v.id, { type, label, v });
  }
  const firstGenerated = (kind) => sections.find((s) => s.kind === kind && s.origin === 'generated')?.id ?? null;
  return {
    manifest,
    excerpts,
    stale,
    evidence: new Map(manifest.evidence.map((e) => [e.id, e])),
    components: new Map(manifest.analysis.components.map((x) => [x.id, x])),
    history: new Map(manifest.history.map((h) => [h.id, h])),
    lastHistory: manifest.history.at(-1),
    vizs,
    /** Evidence ids that already have an anchor, so each id is used once. */
    anchored: new Set(),
    interactive,
    /** Set once an interactive impact diagram is drawn: the page then carries the script. */
    scripted: false,
    // Evidence anchors and the unknowns list live in the first generated
    // section of their kind, or in an appendix when there is none.
    evidenceHome: firstGenerated('references'),
    unknownsHome: firstGenerated('unknowns'),
  };
}

function header(c) {
  const { metadata } = c.manifest;
  const { feature, repository } = metadata;
  const last = c.lastHistory;
  const staleCount = c.stale.size;
  return html`<p class="lede">${feature.description}</p>
<dl class="meta">
<dt>Feature id</dt><dd><code>${feature.id}</code></dd>
<dt>Mode</dt><dd>${feature.mode === 'change-impact' ? 'Change impact' : 'Existing feature'}</dd>
<dt>Evidence</dt><dd>${c.manifest.evidence.length} source reference(s)${staleCount
  ? html`; <span class="badge unverified">${staleCount} unverified</span> (stale, see below)`
  : ''}</dd>
<dt>Repository</dt><dd>${repository.name}${repository.branch ? html`, branch <code>${repository.branch}</code>` : ''}${repository.revision ? html`, revision <code>${repository.revision}</code>` : ''}${repository.dirty ? ' (working tree had uncommitted changes)' : ''}${repository.remoteUrl ? html`, remote <code>${repository.remoteUrl}</code>` : ''}</dd>
<dt>Generated</dt><dd>${metadata.generatedAt} by ${person(metadata.generatedBy)}</dd>
<dt>Last updated</dt><dd>${metadata.updatedAt} (history entry <code>${last.id}</code>, ${last.action})</dd>
<dt>Last recorded validation</dt><dd>${validation(last.validation)}</dd>
<dt>Contributors</dt><dd>${metadata.contributors.length
  ? html`<ul class="people">${metadata.contributors.map((p) => html`<li>${person(p)}${p.commits !== undefined ? html` · ${p.commits} commit(s)` : ''}</li>`)}</ul>`
  : 'None recorded'}</dd>
</dl>`;
}

function section(c, s) {
  const generated = s.origin === 'generated';
  const findings = c.manifest.analysis.findings.filter((f) => f.section === s.id);
  const content = generated ? KIND_CONTENT[s.kind](c) : null;
  return html`<section id="section-${s.id}" class="${generated ? 'generated' : 'manual'} kind-${s.kind}">
<h2>${s.title}</h2>
<p class="provenance">${generated
  ? html`<span class="badge generated">generated</span> Written by FeatureLens from the analysis; regenerated on update.`
  : html`<span class="badge manual">manual</span> Written by a person; FeatureLens never rewrites it.`} ${provenance(c, s.provenance.historyId)}</p>
${s.body !== undefined ? html`<div class="body">${s.body}</div>
` : ''}${s.sourceRefs?.length ? html`<p class="sources">Sources: ${refs(c, s.sourceRefs)}</p>
` : ''}${content ? html`${content}
` : ''}${findings.length ? html`<ul class="claims findings">
${findings.map((f) => html`<li>${claimHead(c, f, f.title)}<div class="body">${f.body}</div></li>
`)}</ul>
` : ''}${(s.visualizations ?? []).map((id) => visualization(c, id))}</section>
`;
}

function provenance(c, historyId) {
  const h = c.history.get(historyId);
  if (!h) return html`Last changed in history entry <code>${historyId}</code>.`;
  return html`Last changed in <code>${h.id}</code> (${h.action}, ${h.at}, by ${person(h.by)}).`;
}

function overview(c) {
  const { feature } = c.manifest.metadata;
  return html`<dl class="meta">
<dt>Request</dt><dd class="body">${feature.request}</dd>
${feature.proposedChange ? html`<dt>Proposed change</dt><dd class="body">${feature.proposedChange}</dd>
` : ''}</dl>`;
}

function scope(c) {
  const { scope: sc } = c.manifest.analysis;
  const list = (items, empty) => (items.length ? html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>` : html`<p class="empty">${empty}</p>`);
  return html`<div class="body">${sc.summary}</div>
<h3>In scope</h3>
${list(sc.inScope, 'Nothing listed.')}
<h3>Out of scope</h3>
${list(sc.outOfScope, 'Nothing listed.')}
${sc.entryPoints?.length ? html`<h3>Entry points</h3>
${list(sc.entryPoints.map((id) => componentName(c, id)), '')}` : ''}`;
}

function architecture(c) {
  const { components, relationships } = c.manifest.analysis;
  return html`<h3>Components</h3>
${components.length ? html`<ul class="claims">
${components.map((x) => html`<li>${claimHead(c, x, html`${x.name} <span class="kind">${x.kind}</span>`)}${x.parent ? html`<p class="detail">Part of ${componentName(c, x.parent)}</p>` : ''}${x.endpoint
  ? html`<p class="detail">Endpoint: <code>${x.endpoint.method ? `${x.endpoint.method} ` : ''}${x.endpoint.path}</code> (${x.endpoint.protocol})</p>`
  : ''}${x.dependency
  ? html`<p class="detail">Dependency: <code>${x.dependency.name}${x.dependency.version ? `@${x.dependency.version}` : ''}</code>${x.dependency.ecosystem ? ` (${x.dependency.ecosystem})` : ''}</p>`
  : ''}<div class="body">${x.summary}</div></li>
`)}</ul>` : html`<p class="empty">No components were recorded.</p>`}
<h3>Relationships</h3>
${relationships.length ? html`<ul class="claims">
${relationships.map((r) => html`<li>${claimHead(c, r, html`${componentName(c, r.from)} <span class="kind">${r.kind}</span> ${componentName(c, r.to)}`)}${r.label ? html`<div class="body">${r.label}</div>` : ''}</li>
`)}</ul>` : html`<p class="empty">No relationships were recorded.</p>`}`;
}

function implementation(c) {
  const { files } = c.manifest.analysis;
  if (!files.length) return html`<p class="empty">No relevant files were recorded.</p>`;
  return html`<h3>Relevant files</h3>
<ul class="files">
${files.map((f) => html`<li><code>${f.path}</code> <span class="kind">${f.role}</span><div class="body">${f.reason}</div>${f.evidence?.length ? html`<p class="sources">Sources: ${refs(c, f.evidence)}</p>` : ''}</li>
`)}</ul>`;
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
  return html`${imp.summary ? html`<div class="body">${imp.summary}</div>
` : ''}<h3>Impact diagram</h3>
${impactFigure(c)}
<h3>Direct impact</h3>
${imp.items.length ? html`<ul class="claims impact-direct">
${imp.items.map((i) => html`<li>${claimHead(c, i, html`${itemTarget(c, i)} <span class="badge level-${i.level}">${i.level}</span> <span class="kind">${i.change}</span>`)}<div class="body">${i.reason}</div></li>
`)}</ul>` : html`<p class="empty">No impact items were recorded.</p>`}
<h3>Declared impact relationships</h3>
${imp.relationships.length ? html`<ul class="claims">
${imp.relationships.map((r) => html`<li>${claimHead(c, r, html`${itemName(r.from)} → ${itemName(r.to)}`)}<div class="body">${r.reason}</div></li>
`)}</ul>` : html`<p class="empty">No impact relationships were recorded.</p>`}
<h3>Derived (indirect) impact</h3>
<p class="derived-note"><span class="badge derived">derived</span> Not a claim of the analysis and not backed by evidence: FeatureLens lists components that depend, directly or through other components, on something directly impacted, following the declared relationships.</p>
${derived.length ? html`<ul class="impact-derived">
${derived.map((n) => html`<li><span class="badge derived">derived</span> ${n.label} <span class="kind">${n.kind}</span></li>
`)}</ul>` : html`<p class="empty">No component depends on a directly impacted one.</p>`}`;
}

/** The impact diagram; in an interactive document, wrapped for the script when there is something to draw. */
function impactFigure(c) {
  const model = diagramModel(() => impactDiagram(c.manifest));
  const empty = 'Nothing to draw: no impact items were recorded.';
  if (!c.interactive || model.nodes.length === 0) return diagram(model, diagramContext(c), { empty });
  c.scripted = true;
  return html`<div class="impact-graph">
${diagram(model, diagramContext(c), { empty, interactive: true })}
</div>`;
}

function itemTarget(c, i) {
  const parts = [];
  if (i.componentId) parts.push(componentName(c, i.componentId));
  if (i.file) parts.push(html`<code>${i.file}</code>`);
  return html`${parts.map((p, n) => html`${n ? ' · ' : ''}${p}`)}`;
}

function notes(c, list, empty) {
  if (!list.length) return html`<p class="empty">${empty}</p>`;
  return html`<ul class="claims">
${list.map((n) => html`<li>${claimHead(c, n, html`${n.title}${n.severity ? html` <span class="badge level-${n.severity}">${n.severity}</span>` : ''}`)}<div class="body">${n.body}</div></li>
`)}</ul>`;
}

function unknowns(c) {
  const list = c.manifest.analysis.unknowns;
  if (!list.length) return html`<p class="empty">No unknowns or limitations were recorded.</p>`;
  return html`<ul class="claims unknowns">
${list.map((u) => html`<li><p class="claim-head"><span class="badge unknown">${u.kind}</span> ${u.statement}</p><div class="body">${u.reason}</div>${u.evidence?.length ? html`<p class="sources">Sources: ${refs(c, u.evidence)}</p>` : ''}</li>
`)}</ul>`;
}

function history(c) {
  return html`<div class="table-scroll">
<table>
<thead><tr><th scope="col">Entry</th><th scope="col">When</th><th scope="col">By</th><th scope="col">Summary</th><th scope="col">Revision</th><th scope="col">Changed</th><th scope="col">Validation</th></tr></thead>
<tbody>
${c.manifest.history.map((h) => html`<tr><td><code>${h.id}</code> ${h.action}</td><td>${h.at}</td><td>${person(h.by)} <span class="detail">FeatureLens ${h.toolVersion}</span></td><td class="body">${h.summary}</td><td>${h.previousRevision ? html`<code>${h.previousRevision}</code> → ` : ''}${h.revision ? html`<code>${h.revision}</code>` : '—'}</td><td>${h.changedSections.length ? html`Sections: ${h.changedSections.map((s, n) => html`${n ? ', ' : ''}<code>${s}</code>`)}` : ''}${h.changedFiles.length ? html`<br>Files: ${h.changedFiles.map((f, n) => html`${n ? ', ' : ''}<code>${f}</code>`)}` : ''}</td><td>${validation(h.validation)}</td></tr>
`)}</tbody>
</table>
</div>`;
}

function evidenceCatalog(c) {
  if (!c.manifest.evidence.length) return html`<p class="empty">No source evidence is cited.</p>`;
  return html`${c.manifest.evidence.map((ev) => evidenceEntry(c, ev))}`;
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
    state = html`<p class="current"><span class="badge current">current</span> Matches the stamped snippet hash.</p>
<pre class="excerpt"><code>${x.text.split('\n').map((line, n) => html`${n ? '\n' : ''}<span class="ln">${ev.startLine + n}</span>${line}`)}</code></pre>`;
  } else {
    state = html`<p class="detail"><span class="badge missing">no excerpt</span> No source excerpt was supplied for this reference.</p>`;
  }
  const id = c.anchored.has(ev.id) ? null : ev.id;
  c.anchored.add(ev.id);
  return html`<article class="evidence${s ? ' is-stale' : ''}"${id ? html` id="evidence-${id}"` : ''}>
<h3><code>${ev.file}:${ev.startLine}-${ev.endLine}</code></h3>
<p class="detail"><code>${ev.id}</code> · ${ev.kind} · confidence ${ev.confidence}${ev.symbol ? html` · symbol <code>${ev.symbol}</code>` : ''}${ev.revision ? html` · revision <code>${ev.revision}</code>` : ''}</p>
<div class="body">${ev.explanation}</div>
${state}
</article>
`;
}

function visualization(c, id) {
  const found = c.vizs.get(id);
  if (!found) return html`<p class="empty">Visualization <code>${id}</code> is not in the manifest.</p>\n`;
  return html`<figure class="viz">
<figcaption>${found.v.title} <span class="kind">${found.label}</span></figcaption>
${found.v.description ? html`<div class="body">${found.v.description}</div>
` : ''}${VIZ_DRAW[found.type](c, found.v)}
</figure>
`;
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

function diagramContext(c) {
  return { sources: (ids) => refs(c, ids), isStale: (id) => c.stale.has(id) };
}

/** Title line of a claim: certainty, title, evidence links. */
function claimHead(c, claim, title) {
  return html`<p class="claim-head"><span class="badge certainty-${claim.certainty}">${claim.certainty}</span> ${title}</p>${claim.evidence?.length
    ? html`<p class="sources">Sources: ${refs(c, claim.evidence)}</p>`
    : ''}`;
}

function refs(c, ids) {
  return html`${ids.map((id, n) => html`${n ? ', ' : ''}${ref(c, id)}`)}`;
}

function ref(c, id) {
  const ev = c.evidence.get(id);
  if (!ev) return html`<code>${id}</code> (not in the manifest)`;
  const s = c.stale.get(id);
  return html`<a class="ref" href="#evidence-${id}"><code>${ev.file}:${ev.startLine}-${ev.endLine}</code></a>${s ? html` <span class="badge unverified">unverified</span>` : ''}`;
}

function componentName(c, id) {
  const x = c.components.get(id);
  return x ? html`${x.name}` : html`<code>${id}</code>`;
}

/** A person as recorded. Names are display names; a GitHub login appears only when the manifest has one. */
function person(p) {
  const name = p.name ?? (p.source === 'unknown' ? 'Unknown' : 'Unnamed');
  return html`<span class="person">${name}${p.email ? html` &lt;${p.email}&gt;` : ''}${p.githubLogin ? html` (GitHub <code>${p.githubLogin}</code>)` : ''} <span class="detail">source: ${p.source}</span></span>`;
}

function validation(v) {
  return html`${v.valid ? 'valid' : 'invalid'}, ${v.errorCount} error(s), ${v.warningCount} warning(s), evidence ${v.evidenceChecked ? 'checked against the repository' : 'not checked against the repository'}`;
}

const STYLE = `
:root{--fg:#1d1f23;--muted:#5d6470;--bg:#fff;--panel:#f5f6f8;--line:#d9dce1;--accent:#2754c5;--warn:#9a3b00;--warn-bg:#fff1e6;--ok:#1e6b35;--ok-bg:#e8f5ec;--derived:#6b4fa0;--derived-bg:#f1ecfa}
@media (prefers-color-scheme:dark){:root{--fg:#e4e6ea;--muted:#9aa1ad;--bg:#15171a;--panel:#1e2125;--line:#33373d;--accent:#8fb0ff;--warn:#ffb784;--warn-bg:#3a2415;--ok:#8fd4a4;--ok-bg:#16301f;--derived:#c8b4f0;--derived-bg:#2a2238}}
*{box-sizing:border-box}
body{margin:0 auto;max-width:60rem;padding:1.5rem 1rem 4rem;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg);overflow-wrap:anywhere}
h1{font-size:1.9rem;margin:0 0 .5rem}h2{margin-top:2.5rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}h3{margin-top:1.5rem;font-size:1.05rem}
a{color:var(--accent)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
.lede{font-size:1.1rem;color:var(--muted)}.body{white-space:pre-line}.detail,.provenance,.sources,.empty{color:var(--muted);font-size:.9em}
dl.meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.25rem 1rem}dl.meta dt{font-weight:600}dl.meta dd{margin:0}
ul.claims,ul.files,ul.impact-derived{list-style:none;padding:0}ul.claims>li,ul.files>li,ul.impact-derived>li{border:1px solid var(--line);border-radius:6px;padding:.6rem .8rem;margin:.5rem 0;background:var(--panel)}
.claim-head{margin:0;font-weight:600}.kind{font-weight:400;color:var(--muted);font-size:.85em}
.badge{display:inline-block;border-radius:4px;padding:0 .4em;font-size:.78em;font-weight:600;border:1px solid var(--line);background:var(--bg)}
.badge.unverified,.badge.missing{color:var(--warn);background:var(--warn-bg);border-color:var(--warn)}.badge.current{color:var(--ok);background:var(--ok-bg);border-color:var(--ok)}
.badge.derived{color:var(--derived);background:var(--derived-bg);border-color:var(--derived)}.badge.manual{border-style:dashed}
section.manual{border-left:3px dashed var(--line);padding-left:1rem}
article.evidence{border:1px solid var(--line);border-radius:6px;padding:.4rem .8rem;margin:.8rem 0}article.evidence h3{margin:.3rem 0}article.is-stale{border-color:var(--warn)}
pre.excerpt{background:var(--panel);padding:.6rem;overflow-x:auto;max-width:100%;border-radius:4px;overflow-wrap:normal}.ln{display:inline-block;min-width:3ch;margin-right:1ch;color:var(--muted);text-align:right;user-select:none}
table{border-collapse:collapse;width:100%;font-size:.9em}th,td{border:1px solid var(--line);padding:.3rem .5rem;text-align:left;vertical-align:top}
.table-scroll{overflow-x:auto;max-width:100%}.table-scroll>table{min-width:44rem}
figure.viz{border:1px dashed var(--line);border-radius:6px;padding:.6rem .8rem;margin:1rem 0}figcaption{font-weight:600}
.diagram-scroll{overflow-x:auto;max-width:100%}
svg.diagram{display:block;margin:.6rem auto;height:auto;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}svg.diagram.fit{max-width:100%}svg.diagram.wide{max-width:none}
svg.diagram rect{fill:var(--panel);stroke:var(--muted);stroke-width:1.5}svg.diagram .direct rect{stroke:var(--accent);stroke-width:2.5}svg.diagram .derived rect{fill:var(--derived-bg);stroke:var(--derived);stroke-dasharray:6 4}svg.diagram .node.unverified rect{stroke:var(--warn)}
svg.diagram text{fill:var(--fg);font-size:13px}svg.diagram text.status{fill:var(--muted);font-size:11px}
svg.diagram .group rect{fill:none;stroke:var(--muted);stroke-width:1}svg.diagram text.group-label{font-size:12px;font-weight:600;paint-order:stroke;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round}
svg.diagram .line{fill:none;stroke:var(--muted);stroke-width:1.5}svg.diagram .head{fill:var(--muted)}svg.diagram .edge.derived .line{stroke:var(--derived);stroke-dasharray:6 4}svg.diagram .edge.derived .head{fill:var(--derived)}svg.diagram .edge.unverified .line{stroke:var(--warn);stroke-dasharray:2 3}svg.diagram .edge.unverified .head{fill:var(--warn)}
ul.diagram-legend{list-style:none;padding:0;font-size:.9em;color:var(--muted)}.swatch{display:inline-block;width:1.6em;height:.9em;vertical-align:middle;margin-right:.3em}
.swatch.node-direct{border:2px solid var(--accent)}.swatch.node-derived{border:2px dashed var(--derived)}.swatch.edge-declared{border-bottom:2px solid var(--muted)}.swatch.edge-derived{border-bottom:2px dashed var(--derived)}.swatch.edge-unverified{border-bottom:2px dotted var(--warn)}.swatch.group-box{border:1px solid var(--muted);border-radius:4px}
.diagram-summary h4{margin:.8rem 0 .2rem}.diagram-summary ul{padding-left:1.2rem}.diagram-summary p.detail{margin:.1rem 0}
svg.diagram path.shape{fill:var(--panel);stroke:var(--muted);stroke-width:1.5}svg.diagram .node.start rect,svg.diagram .node.start path.shape,svg.diagram .node.initial rect{stroke-width:3.5}svg.diagram .node.unverified path.shape{stroke:var(--warn)}
svg.diagram rect.inner{fill:none}svg.diagram path.mark{fill:none;stroke:var(--muted);stroke-width:1.5}
svg.diagram text.seq-index{font-size:10px;font-weight:600;fill:var(--muted)}svg.diagram text.edge-label{font-size:11px;paint-order:stroke;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round}
svg.diagram .participant rect{stroke:var(--fg)}svg.diagram .lifeline{fill:none;stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4}
svg.diagram .message .line{fill:none;stroke:var(--fg);stroke-width:1.5}svg.diagram .message .head{fill:var(--fg)}svg.diagram .head.open{fill:none;stroke:var(--fg);stroke-width:1.5}
svg.diagram .message.return .line{stroke-dasharray:6 4}svg.diagram .message.event .line{stroke-dasharray:2 3}svg.diagram .message.unverified .line{stroke:var(--warn)}svg.diagram .message.unverified .head{fill:var(--warn)}svg.diagram .message.unverified .head.open{fill:none;stroke:var(--warn)}
.swatch.node-start{border:3px solid var(--muted)}.swatch.node-terminal{border:3px double var(--muted)}.swatch.msg-call,.swatch.msg-async{border-bottom:2px solid var(--fg)}.swatch.msg-return{border-bottom:2px dashed var(--fg)}.swatch.msg-event{border-bottom:2px dotted var(--fg)}
@media (max-width:40rem){dl.meta{grid-template-columns:1fr}}
`;
