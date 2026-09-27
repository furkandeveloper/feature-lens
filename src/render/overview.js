// The overview page: what the feature is, the facts that matter, and where
// to go deeper. Everything on it is taken from the manifest; it adds no
// claim. It only selects and orders: counts, titles that link to the full
// claims, the first execution flow as numbered steps (product view), and
// where the feature lives in the code (developer view).

import { html } from './escape.js';
import { claimSources, componentName, person, sourceChip, validation } from './claims.js';

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const HOME_LIMIT = 3;
const STEP_LIMIT = 8;

/**
 * @param {object} c the render context
 * @param {import('./escape.js').Html | string} summary the embedded overview section, or ''
 */
export function overviewPage(c, summary) {
  return html`${hero(c)}
${facts(c)}${summary}<div class="home-grid">
${c.mode === 'product' ? howItWorks(c) : whereItLives(c)}${keyFindings(c)}${importantRisks(c)}${openQuestions(c)}${diagrams(c)}</div>
`;
}

function hero(c) {
  const { metadata } = c.manifest;
  const { feature, repository } = metadata;
  const last = c.lastHistory;
  const staleCount = c.stale.size;
  const evidenceCount = c.manifest.evidence.length;
  return html`<header>
<p class="eyebrow">${feature.mode === 'change-impact' ? 'Change impact' : 'Existing feature'} · ${c.words.view}</p>
<h1>${feature.name}</h1>
<p class="lede">${feature.description}</p>
<ul class="hero-meta">
<li><span class="hm-label">Repository</span> ${repository.name}</li>
${repository.branch ? html`<li><span class="hm-label">Branch</span> <code>${repository.branch}</code></li>
` : ''}${repository.revision ? html`<li><span class="hm-label">Revision</span> <code>${repository.revision.slice(0, 12)}</code>${repository.dirty ? ' (uncommitted changes)' : ''}</li>
` : ''}<li><span class="hm-label">Updated</span> ${metadata.updatedAt.slice(0, 10)}</li>
</ul>
<p class="status-line">${staleCount
  ? html`<span class="badge unverified">${staleCount} unverified</span> ${staleCount} of ${evidenceCount} cited source location(s) no longer match the code; the claims citing them are marked.`
  : evidenceCount
    ? html`<span class="badge current">evidence current</span> All ${evidenceCount} cited source location(s) matched the code when this page was rendered.`
    : html`<span class="badge missing">no evidence</span> No source locations are cited.`}</p>
<details class="doc-details">
<summary>Document details</summary>
<dl class="meta">
<dt>Feature id</dt><dd><code>${feature.id}</code></dd>
<dt>Mode</dt><dd>${feature.mode === 'change-impact' ? 'Change impact' : 'Existing feature'}</dd>
<dt>Evidence</dt><dd>${evidenceCount} source reference(s)${staleCount
  ? html`; <span class="badge unverified">${staleCount} unverified</span> (stale, see below)`
  : ''}</dd>
<dt>Repository</dt><dd>${repository.name}${repository.branch ? html`, branch <code>${repository.branch}</code>` : ''}${repository.revision ? html`, revision <code>${repository.revision}</code>` : ''}${repository.dirty ? ' (working tree had uncommitted changes)' : ''}${repository.remoteUrl ? html`, remote <code>${repository.remoteUrl}</code>` : ''}</dd>
<dt>Generated</dt><dd>${metadata.generatedAt} by ${person(metadata.generatedBy)}</dd>
<dt>Last updated</dt><dd>${metadata.updatedAt} (history entry <code>${last.id}</code>, ${last.action})</dd>
<dt>Last recorded validation</dt><dd>${validation(last.validation)}</dd>
<dt>Contributors</dt><dd>${metadata.contributors.length
  ? html`<ul class="people">${metadata.contributors.map((p) => html`<li>${person(p)}${p.commits !== undefined ? html` · ${p.commits} commit(s)` : ''}</li>`)}</ul>`
  : 'None recorded'}</dd>
</dl>
</details>
</header>`;
}

/** Counts that link to where the items are listed. Zero counts are left out. */
function facts(c) {
  const { analysis, evidence } = c.manifest;
  const high = analysis.risks.filter((r) => r.severity === 'high').length;
  const product = c.mode === 'product';
  const list = [
    [analysis.components.length, product ? 'building blocks' : 'components', null, c.hrefOfKind('architecture')],
    [analysis.findings.length, product ? 'key points' : 'findings', null, null],
    [c.diagramCount, 'diagrams', null, null],
    [analysis.risks.length, 'risks', high ? `${high} high` : null, c.hrefOfKind('risks')],
    [analysis.unknowns.length, product ? 'open questions' : 'unknowns', null, c.unknownsHref],
    [evidence.length, product ? 'cited sources' : 'evidence refs', c.stale.size ? `${c.stale.size} unverified` : null, c.evidenceHref],
  ].filter(([n]) => n > 0);
  if (!list.length) return '';
  return html`<ul class="facts" aria-label="Key facts">
${list.map(([n, label, note, href]) => {
    const inner = html`<span class="fact-n">${n}</span> <span class="fact-l">${label}</span>${note ? html` <span class="fact-note">${note}</span>` : ''}`;
    return html`<li>${href ? html`<a href="${href}">${inner}</a>` : inner}</li>
`;
  })}</ul>
`;
}

/** Product view: the first execution flow (else the first sequence) as numbered steps. */
function howItWorks(c) {
  const flow = c.manifest.visualizations.executionFlows?.[0];
  const seq = c.manifest.visualizations.sequences?.[0];
  let items;
  let source;
  let rest = 0;
  if (flow && flow.steps.length) {
    const ordered = flowOrder(flow);
    const labels = new Map(flow.steps.map((s) => [s.id, s.label]));
    rest = flow.steps.length - Math.min(ordered.length, STEP_LIMIT);
    items = ordered.slice(0, STEP_LIMIT).map((s) => {
      const branches = (s.next ?? []).filter((n) => labels.has(n.to));
      const branching = branches.length > 1 || branches.some((n) => n.condition);
      return html`<li><span class="step-label">${s.label}</span>${s.componentId && c.components.has(s.componentId) ? html` <span class="step-where">${componentName(c, s.componentId)}</span>` : ''}${branching ? html`
<ul class="branches">
${branches.map((n) => html`<li><span class="cond">${n.condition ?? 'otherwise'}</span> → ${labels.get(n.to)}</li>
`)}</ul>` : ''}</li>
`;
    });
    source = flow;
  } else if (seq && seq.messages.length) {
    const names = new Map(seq.participants.map((p) => [p.id, p.label]));
    rest = seq.messages.length - Math.min(seq.messages.length, STEP_LIMIT);
    items = seq.messages.slice(0, STEP_LIMIT).map((m) => html`<li><span class="step-label">${m.label}</span> <span class="step-where">${names.get(m.from)} → ${names.get(m.to)}</span></li>
`);
    source = seq;
  } else {
    return '';
  }
  const href = c.vizHref.get(source.id);
  return html`<div class="card card-wide">
<h2 class="card-title">How it works</h2>
<p class="card-lede">${source.title}${source.description ? html`: ${source.description}` : ''}</p>
<ol class="steps">
${items}</ol>
${rest > 0 ? html`<p class="detail">${rest} more step(s) in the full diagram.</p>
` : ''}${href ? html`<p class="card-link"><a href="${href}">See the full diagram</a></p>
` : ''}</div>
`;
}

/** Steps reachable from the start, breadth first, each once; next links in their declared order. */
export function flowOrder(flow) {
  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  const queue = byId.has(flow.start) ? [flow.start] : [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    out.push(s);
    for (const n of s.next ?? []) if (byId.has(n.to) && !seen.has(n.to)) queue.push(n.to);
  }
  return out;
}

/** Developer view: entry points, primary files and configuration. */
function whereItLives(c) {
  const { analysis, evidence } = c.manifest;
  const entries = (analysis.scope.entryPoints ?? []).filter((id) => c.components.has(id)).map((id) => c.components.get(id));
  const primary = analysis.files.filter((f) => f.role === 'primary');
  const configs = analysis.components.filter((x) => x.kind === 'config');
  const cited = new Set(configs.flatMap((x) => x.evidence ?? []));
  const configEvidence = evidence.filter((e) => e.kind === 'configuration' && !cited.has(e.id));
  if (!entries.length && !primary.length && !configs.length && !configEvidence.length) return '';
  return html`<div class="card card-wide">
<h2 class="card-title">Where it lives</h2>
${entries.length ? html`<h3>Entry points</h3>
<ul class="where">
${entries.map((x) => html`<li>${componentLink(c, x)} <span class="kind">${x.kind}</span>${x.endpoint ? html` <code>${x.endpoint.method ? `${x.endpoint.method} ` : ''}${x.endpoint.path}</code>` : ''}${x.evidence?.length ? html` ${sourceChip(c, x.evidence[0])}` : ''}</li>
`)}</ul>
` : ''}${primary.length ? html`<h3>Primary files</h3>
<ul class="where">
${primary.map((f) => html`<li><code>${f.path}</code><span class="where-why">${f.reason}</span></li>
`)}</ul>
` : ''}${configs.length || configEvidence.length ? html`<h3>Configuration</h3>
<ul class="where">
${configs.map((x) => html`<li>${componentLink(c, x)}<span class="where-why">${x.summary}</span>${claimSources(c, x.evidence)}</li>
`)}${configEvidence.map((e) => html`<li>${sourceChip(c, e.id)}<span class="where-why">${e.explanation}</span></li>
`)}</ul>
` : ''}</div>
`;
}

/** A link to the component's entry when a section lists it, else its name. */
function componentLink(c, x) {
  return c.anchored.has(`component:${x.id}`) ? html`<a href="#component-${x.id}">${x.name}</a>` : html`<strong>${x.name}</strong>`;
}

/** Findings outside the embedded overview section, as links to where they are shown. */
function keyFindings(c) {
  const list = c.manifest.analysis.findings.filter((f) => c.sectionTitles.has(f.section) && f.section !== c.homeSectionId);
  if (!list.length) return '';
  return html`<div class="card">
<h2 class="card-title">${c.mode === 'product' ? 'Go deeper' : 'Key findings'}</h2>
<ul class="link-list">
${list.map((f) => html`<li><a href="#finding-${f.id}">${f.title}</a> <span class="link-where">${c.sectionTitles.get(f.section)}</span></li>
`)}</ul>
</div>
`;
}

function importantRisks(c) {
  const risks = c.manifest.analysis.risks;
  if (!risks.length) return '';
  const ranked = risks.map((r, i) => [r, i]).sort(([a, i], [b, j]) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || i - j).map(([r]) => r);
  const top = ranked.slice(0, HOME_LIMIT);
  return html`<div class="card card-risk">
<h2 class="card-title">Risks to know</h2>
<ul class="link-list">
${top.map((r) => html`<li>${r.severity ? html`<span class="badge level-${r.severity}">${r.severity}</span> ` : ''}${c.anchored.has(`risk:${r.id}`) ? html`<a href="#risk-${r.id}">${r.title}</a>` : r.title}</li>
`)}</ul>
${risks.length > top.length && c.hrefOfKind('risks') ? html`<p class="card-link"><a href="${c.hrefOfKind('risks')}">All ${risks.length} risks</a></p>
` : ''}</div>
`;
}

function openQuestions(c) {
  const list = c.manifest.analysis.unknowns;
  if (!list.length) return '';
  const top = list.slice(0, HOME_LIMIT);
  return html`<div class="card card-unknown">
<h2 class="card-title">${c.mode === 'product' ? 'Open questions' : 'Unknowns'}</h2>
<ul class="link-list">
${top.map((u) => html`<li><span class="badge unknown">${c.words.unknownKind[u.kind] ?? u.kind}</span> <a href="#unknown-${u.id}">${u.statement}</a></li>
`)}</ul>
${list.length > top.length ? html`<p class="card-link"><a href="${c.unknownsHref}">All ${list.length}</a></p>
` : ''}</div>
`;
}

function diagrams(c) {
  if (!c.diagramLinks.length) return '';
  return html`<div class="card">
<h2 class="card-title">Diagrams</h2>
<ul class="link-list">
${c.diagramLinks.map((d) => html`<li><a href="${d.href}">${d.label}</a> <span class="link-where">${d.tag}</span></li>
`)}</ul>
</div>
`;
}
