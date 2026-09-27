// How claims, their certainty and their evidence are shown, shared by the
// sections and the overview page. Every function takes the render context
// `c` (render.js) and returns markup built with `html`.

import { html } from './escape.js';
import { CERTAINTY_MEANING } from './presentation.js';

/** Title line of a claim: certainty, then title. */
export function claimHead(c, claim, title) {
  return html`<p class="claim-head">${certainty(c, claim.certainty)} ${title}</p>`;
}

export function certainty(c, value) {
  return html`<span class="badge certainty-${value}">${c.words.certainty[value] ?? value}</span>`;
}

/**
 * What backs a claim. Developer view: its sources as links with the cited
 * symbol. Product view: a collapsed "Technical details" block with the
 * certainty, what it means, and each source with its explanation.
 * @param {string[] | undefined} ids evidence ids
 * @param {{ certaintyOf?: string }} [options] certaintyOf: show this certainty in the product details
 */
export function claimSources(c, ids, { certaintyOf } = {}) {
  const list = ids ?? [];
  if (c.mode === 'developer') {
    return list.length ? html`<p class="sources"><span class="sources-label">Sources</span> ${list.map((id, n) => html`${n ? ' ' : ''}${sourceChip(c, id)}`)}</p>` : '';
  }
  if (!list.length && !certaintyOf) return '';
  return html`<details class="tech"><summary>Technical details${list.length ? ` · ${list.length} source${list.length === 1 ? '' : 's'}` : ''}</summary>
${certaintyOf ? html`<p class="detail">Certainty: <strong>${certaintyOf}</strong>. ${CERTAINTY_MEANING[certaintyOf] ?? ''}</p>
` : ''}${list.length ? html`<ul class="ref-list">
${list.map((id) => html`<li>${sourceChip(c, id)}${explanation(c, id)}</li>
`)}</ul>
` : html`<p class="detail">No evidence cited.</p>
`}</details>`;
}

/** A source link and, when the evidence names one, its symbol. */
export function sourceChip(c, id) {
  const ev = c.evidence.get(id);
  return html`<span class="ref-chip">${ref(c, id)}${ev?.symbol ? html` <span class="ref-sym"><code>${ev.symbol}</code></span>` : ''}</span>`;
}

function explanation(c, id) {
  const ev = c.evidence.get(id);
  return ev ? html`<span class="ref-why">${ev.explanation}</span>` : '';
}

/** Comma-separated source links, as the diagrams' text versions show them. */
export function refs(c, ids) {
  return html`${ids.map((id, n) => html`${n ? ', ' : ''}${ref(c, id)}`)}`;
}

export function ref(c, id) {
  const ev = c.evidence.get(id);
  if (!ev) return html`<code>${id}</code> (not in the manifest)`;
  const s = c.stale.get(id);
  return html`<a class="ref" href="#evidence-${id}"><code>${ev.file}:${ev.startLine}-${ev.endLine}</code></a>${s ? html` <span class="badge unverified">unverified</span>` : ''}`;
}

export function componentName(c, id) {
  const x = c.components.get(id);
  return x ? html`${x.name}` : html`<code>${id}</code>`;
}

/** A person as recorded. Names are display names; a GitHub login appears only when the manifest has one. */
export function person(p) {
  const name = p.name ?? (p.source === 'unknown' ? 'Unknown' : 'Unnamed');
  return html`<span class="person">${name}${p.email ? html` &lt;${p.email}&gt;` : ''}${p.githubLogin ? html` (GitHub <code>${p.githubLogin}</code>)` : ''} <span class="detail">source: ${p.source}</span></span>`;
}

export function validation(v) {
  return html`${v.valid ? 'valid' : 'invalid'}, ${v.errorCount} error(s), ${v.warningCount} warning(s), evidence ${v.evidenceChecked ? 'checked against the repository' : 'not checked against the repository'}`;
}

/** Content that is open in the developer view and collapsed in the product view. */
export function disclose(c, summary, content, { open = c.mode === 'developer', heading = true } = {}) {
  if (open) return heading ? html`<h3>${summary}</h3>
${content}` : content;
  return html`<details class="more"><summary>${summary}</summary>
${content}
</details>`;
}
