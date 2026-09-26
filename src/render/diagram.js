// Static SVG for a diagram model (src/analysis/diagram-model.js), plus a
// legend and a text version. Pure and deterministic like the rest of the
// renderer. The SVG has no scripts, links, ids, url() references or
// external resources, and every value in it is escaped by `html`.
// With `interactive` (the impact diagram in an interactive document,
// ARCHITECTURE.md §6.1.4), nodes, drawn edges and text version items also
// get data-node, data-source and data-target references ("n<index>" in
// model order) for the page's script; nothing else changes.
//
// Layout is a simple layered one: back edges are set aside by a depth-first
// walk in node order, each node goes one layer below the deepest node that
// points at it, and each layer is centered in node order. Edges are
// straight lines between node borders. The impact diagram has no crossing
// reduction and no routing around nodes. Architecture views (models with
// `groups`) use src/render/architecture-layout.js instead: group boxes,
// bounded crossing reduction, and edges that bend through gaps rather than
// pass behind a node on a layer they skip. The text version lists every
// node, edge and group.

import { html } from './escape.js';
import { assignLayers, NODE_W, NODE_H, GAP_X, GAP_Y, MARGIN } from './layers.js';
import { layoutArchitecture, bendsAround } from './architecture-layout.js';

export { NODE_W, NODE_H, GAP_Y, MARGIN };
const LABEL_CHARS = 24;
const LABEL_LINES = 2;
/** Diagrams up to this width scale down to fit narrow screens; wider ones scroll inside their container. */
export const FIT_WIDTH = 480;
/** Where a group's heading starts inside its box, and a rough width per character of its 12px text. */
const GROUP_TEXT_X = 8;
const GROUP_CHAR_W = 9;
/** Characters of an 11px status line that fit in a node, with room to spare for wide glyphs. A
 * grouped node's line names its group, whose label can be long; it is cut there and is complete in
 * the node's <title>, the box heading's <title> and the text version. */
const STATUS_CHARS = 26;

/**
 * @typedef {object} DiagramRenderContext
 * @property {(ids: string[]) => import('./escape.js').Html} sources evidence links, as the rest of the document renders them
 * @property {(id: string) => boolean} isStale whether an evidence id has a stale entry
 */

/**
 * Where each node goes. Self-loops are not drawn.
 * @param {{ nodes: { id: string }[], edges: { source: string, target: string }[] }} model
 *   a diagram model, or any nodes and edges in the same shape
 * @param {string} [first] a node to start the walk from, so it sits on the first
 *   layer (an execution flow's start step, a state machine's initial state);
 *   the walk then goes on in node order
 * @param {number} [gapY] vertical space between layers
 * @returns {{ width: number, height: number, boxes: Map<string, { x: number, y: number, layer: number }> }}
 */
export function layoutDiagram(model, first, gapY = GAP_Y) {
  const layer = assignLayers(model, first);
  const layers = [];
  model.nodes.forEach((_, i) => (layers[layer[i]] ??= []).push(i));
  const widest = Math.max(0, ...layers.map((l) => l.length));
  const width = widest ? MARGIN * 2 + widest * NODE_W + (widest - 1) * GAP_X : 0;
  const height = layers.length ? MARGIN * 2 + layers.length * NODE_H + (layers.length - 1) * gapY : 0;
  const boxes = new Map();
  layers.forEach((l, d) => {
    const row = l.length * NODE_W + (l.length - 1) * GAP_X;
    l.forEach((i, k) => boxes.set(model.nodes[i].id, {
      x: (width - row) / 2 + k * (NODE_W + GAP_X),
      y: MARGIN + d * (NODE_H + gapY),
      layer: d,
    }));
  });
  return { width, height, boxes };
}

/**
 * Break a label into at most `lines` lines of at most `chars` characters,
 * at spaces where possible. A label that doesn't fit ends with "…"; the
 * full label is in the node's <title> and the text version.
 * @param {string} text
 * @returns {string[]}
 */
export function wrapLabel(text, chars = LABEL_CHARS, lines = LABEL_LINES) {
  const words = text.split(/\s+/).filter(Boolean).flatMap((w) => {
    const cps = Array.from(w);
    const parts = [];
    for (let i = 0; i < cps.length; i += chars) parts.push(cps.slice(i, i + chars).join(''));
    return parts;
  });
  const out = [];
  for (const w of words) {
    const last = out.at(-1);
    if (last !== undefined && Array.from(last).length + 1 + Array.from(w).length <= chars) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
  }
  if (out.length <= lines) return out.length ? out : [''];
  const kept = out.slice(0, lines);
  const tail = Array.from(kept[lines - 1]);
  kept[lines - 1] = `${tail.slice(0, chars - 1).join('')}…`;
  return kept;
}

/**
 * The diagram, its legend and its text version.
 * @param {import('../analysis/diagram-model.js').DiagramModel} model
 * @param {DiagramRenderContext} ctx
 * @param {{ empty: string, interactive?: boolean }} options `empty`: what to say when there is
 *   nothing to draw; `interactive`: add the data-* references the impact script reads
 */
export function diagram(model, ctx, { empty, interactive = false }) {
  if (model.nodes.length === 0) return html`<p class="empty">${empty}</p>`;
  const labels = new Map(model.nodes.map((n) => [n.id, n.label]));
  const impact = model.nodes.some((n) => n.impact !== null);
  const refs = interactive ? nodeRefs(model) : null;
  return html`${svg(model, ctx, labels, refs)}
${legend(model, impact)}
${summary(model, ctx, labels, refs)}`;
}

/**
 * "n<index>" for each node, in model order. Generated here, never taken from
 * manifest ids, so only these fixed-shape values reach the attributes the
 * page's script reads.
 */
function nodeRefs(model) {
  return new Map(model.nodes.map((n, i) => [n.id, `n${i}`]));
}

/** ` data-node="…"`, or ` data-source="…" data-target="…"`; nothing in a static document. */
function refAttrs(refs, node, target) {
  if (!refs) return '';
  if (target === undefined) return html` data-node="${refs.get(node)}"`;
  return html` data-source="${refs.get(node)}" data-target="${refs.get(target)}"`;
}

function svg(model, ctx, labels, refs) {
  const architecture = model.groups !== undefined;
  const layout = architecture ? layoutArchitecture(model) : layoutDiagram(model);
  const { width, height, boxes } = layout;
  const drawn = model.edges.filter((e) => e.source !== e.target);
  // One line per source, target and basis; parallel edges share it.
  const groups = new Map();
  for (const e of drawn) {
    const key = JSON.stringify([e.source, e.target, e.basis]);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const pairs = new Set(drawn.map((e) => JSON.stringify([e.source, e.target])));
  const edgeCount = model.edges.length;
  const boxed = architecture ? layout.groups : [];
  const inGroups = boxed.length ? `, ${boxed.length} group(s)` : '';
  return html`<div class="diagram-scroll">
<svg class="diagram ${width <= FIT_WIDTH ? 'fit' : 'wide'}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${model.title}: ${model.nodes.length} node(s) and ${edgeCount} relationship(s)${inGroups}, listed in the text version below">
<title>${model.title}</title>
${boxed.map((g) => groupShape(g, model))}${[...groups.values()].map((es) => {
    const reverse = pairs.has(JSON.stringify([es[0].target, es[0].source]));
    return edgeShape(es, boxes, reverse, ctx, labels, architecture ? bends(es[0], layout, reverse) : [], refs);
  })}${boxed.map(groupHeading)}${model.nodes.map((n) => nodeShape(n, boxes.get(n.id), ctx, refs))}</svg>
</div>`;
}

/**
 * Architecture views only: where an edge that skips layers bends to stay
 * clear of the nodes between its ends ([] for a straight line). Opposite
 * edges between the same nodes are moved 5px to either side.
 */
function bends(e, layout, reverse) {
  const a = layout.boxes.get(e.source);
  const b = layout.boxes.get(e.target);
  return bendsAround(a, b, layout, reverse ? 5 * Math.sign(b.layer - a.layer) : 0);
}

/**
 * A group box: drawn first, so edges and nodes are on top of it, with no
 * fill, so it hides nothing.
 */
function groupShape(g, model) {
  const count = model.groups.find((x) => x.id === g.id).nodeIds.length;
  return html`<g class="group">
<title>Group ${g.label}: ${count} node(s). Declared by this view to organize it; not a claim.</title>
<rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.width)}" height="${num(g.height)}" rx="10"></rect>
</g>
`;
}

/**
 * A group's heading: drawn after the edges, so a line crossing the heading
 * band doesn't cover it (its halo interrupts the line), and before the
 * nodes; arrowheads end at node borders, below the band. Cut to fit the
 * box; the full label is in the box's <title> and the text version.
 */
function groupHeading(g) {
  const chars = Math.max(4, Math.floor((g.width - 2 * GROUP_TEXT_X) / GROUP_CHAR_W));
  return html`<text class="group-label" x="${num(g.x + GROUP_TEXT_X)}" y="${num(g.y + 15)}">${clip(g.label, chars)}</text>
`;
}

/** At most `chars` code points; a longer text ends with "…". */
function clip(text, chars) {
  const cps = Array.from(text);
  return cps.length <= chars ? text : `${cps.slice(0, chars - 1).join('')}…`;
}

function nodeShape(n, box, ctx, refs) {
  const lines = wrapLabel(n.label);
  const [status, detail] = nodeStatus(n, ctx);
  const cx = num(box.x + NODE_W / 2);
  const classes = ['node', n.impact ?? 'plain', ...(unverified(n, ctx) ? ['unverified'] : [])].join(' ');
  return html`<g class="${classes}"${refAttrs(refs, n.id)}>
<title>${n.label} (${n.kind}): ${status}; ${detail}</title>
<rect x="${num(box.x)}" y="${num(box.y)}" width="${NODE_W}" height="${NODE_H}" rx="6"></rect>
<text class="label" x="${cx}" y="${num(box.y + 20)}" text-anchor="middle">${lines.map((l, i) => html`<tspan x="${cx}" dy="${i ? 16 : 0}">${l}</tspan>`)}</text>
<text class="status" x="${cx}" y="${num(box.y + NODE_H - 22)}" text-anchor="middle">${n.group ? clip(status, STATUS_CHARS) : status}</text>
<text class="status" x="${cx}" y="${num(box.y + NODE_H - 8)}" text-anchor="middle">${detail}</text>
</g>
`;
}

/** Two short lines under a node's label. Only the text says what the border style means. */
function nodeStatus(n, ctx) {
  if (n.impact === 'derived') return ['derived impact', 'not a claim · no evidence'];
  const head = n.impact === 'direct' ? `direct impact · ${n.level}` : [n.kind, n.group].filter(Boolean).join(' · ');
  return [head, `${n.certainty} · ${evidenceState(n, ctx)}`];
}

function edgeShape(es, boxes, reverse, ctx, labels, bends = [], refs = null) {
  const [first] = es;
  const a = boxes.get(first.source);
  const b = boxes.get(first.target);
  const { line, head } = bends.length ? arrowThrough(a, b, bends) : arrowBetween(a, b, reverse);
  const classes = ['edge', first.basis, ...(es.some((e) => unverified(e, ctx)) ? ['unverified'] : [])].join(' ');
  return html`<g class="${classes}"${refAttrs(refs, first.source, first.target)}>
<title>${es.map((e, i) => html`${i ? '\n' : ''}${edgeText(e, ctx, labels)}`)}</title>
<path class="line" d="${line}"></path>
<path class="head" d="${head}"></path>
</g>
`;
}

/**
 * A straight arrow between the borders of two node boxes: `line` and `head`
 * are path data. With `reverse`, it is moved 5px aside, so that two opposite
 * arrows between the same boxes are drawn side by side.
 * @param {{ x: number, y: number }} a source box
 * @param {{ x: number, y: number }} b target box
 * @param {boolean} reverse
 */
export function arrowBetween(a, b, reverse) {
  const ca = { x: a.x + NODE_W / 2, y: a.y + NODE_H / 2 };
  const cb = { x: b.x + NODE_W / 2, y: b.y + NODE_H / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy);
  const u = { x: dx / len, y: dy / len };
  const p = { x: -u.y, y: u.x };
  // Opposite edges between the same two nodes are drawn side by side.
  const off = reverse ? 5 : 0;
  // Distance from a node's center to its border along the line.
  const toBorder = 1 / Math.max(Math.abs(u.x) / (NODE_W / 2), Math.abs(u.y) / (NODE_H / 2));
  const start = { x: ca.x + u.x * toBorder + p.x * off, y: ca.y + u.y * toBorder + p.y * off };
  const tip = { x: cb.x - u.x * (toBorder + 2) + p.x * off, y: cb.y - u.y * (toBorder + 2) + p.y * off };
  const back = { x: tip.x - u.x * 10, y: tip.y - u.y * 10 };
  const head = `M${num(tip.x)} ${num(tip.y)}L${num(back.x + p.x * 5)} ${num(back.y + p.y * 5)}L${num(back.x - p.x * 5)} ${num(back.y - p.y * 5)}Z`;
  return { line: `M${num(start.x)} ${num(start.y)}L${num(back.x)} ${num(back.y)}`, head, center: ca, u, p, off };
}

/**
 * An arrow from box `a` to box `b` through `bends` (points between them):
 * it leaves `a` toward the first bend and reaches `b` from the last one.
 */
function arrowThrough(a, b, bends) {
  const border = (box, toward) => {
    const c = { x: box.x + NODE_W / 2, y: box.y + NODE_H / 2 };
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    const t = 1 / Math.max(Math.abs(dx) / (NODE_W / 2), Math.abs(dy) / (NODE_H / 2));
    return { x: c.x + dx * t, y: c.y + dy * t };
  };
  const start = border(a, bends[0]);
  const last = bends.at(-1);
  const end = border(b, last);
  const len = Math.hypot(end.x - last.x, end.y - last.y);
  const u = { x: (end.x - last.x) / len, y: (end.y - last.y) / len };
  const p = { x: -u.y, y: u.x };
  const tip = { x: end.x - u.x * 2, y: end.y - u.y * 2 };
  const back = { x: tip.x - u.x * 10, y: tip.y - u.y * 10 };
  const head = `M${num(tip.x)} ${num(tip.y)}L${num(back.x + p.x * 5)} ${num(back.y + p.y * 5)}L${num(back.x - p.x * 5)} ${num(back.y - p.y * 5)}Z`;
  const points = [start, ...bends, back].map((pt, i) => `${i ? 'L' : 'M'}${num(pt.x)} ${num(pt.y)}`).join('');
  return { line: points, head };
}

function edgeText(e, ctx, labels) {
  const ends = `${labels.get(e.source)} → ${labels.get(e.target)}`;
  if (e.basis === 'derived') return `${ends}: derived impact, not a claim, no evidence`;
  return `${ends}: ${e.kind}, ${e.certainty}, ${evidenceState(e, ctx)}${e.label ? `. ${e.label}` : ''}`;
}

function legend(model, impact) {
  const stale = html`<li><span class="swatch edge-unverified"></span> Dotted arrow, "unverified": cites stale evidence that has not been re-checked against the current code.</li>`;
  if (!impact) {
    const drawn = (model.groups ?? []).some((g) => g.nodeIds.length > 0);
    return html`<ul class="diagram-legend">
<li><span class="swatch edge-declared"></span> Arrow: a relationship declared in the analysis (a claim), pointing from <code>from</code> to <code>to</code>.</li>
${drawn ? html`<li><span class="swatch group-box"></span> Box with a heading: a group this view declares, to organize its nodes. Not a claim and not backed by evidence; it does not by itself mean a runtime, deployment or process boundary.</li>
` : ''}${stale}
</ul>`;
  }
  return html`<ul class="diagram-legend">
<li><span class="swatch node-direct"></span> Solid border: directly impacted, named by impact items (claims).</li>
<li><span class="swatch node-derived"></span> Dashed border: derived impact. Not a claim and not backed by evidence: it depends, directly or through other components, on something directly impacted.</li>
<li><span class="swatch edge-declared"></span> Solid arrow: a declared impact relationship (a claim): a change to the source forces or risks a change to the target.</li>
<li><span class="swatch edge-derived"></span> Dashed arrow: derived impact, from a dependency to what depends on it, following a declared relationship.</li>
${stale}
</ul>`;
}

function summary(model, ctx, labels, refs) {
  const name = (id) => labels.get(id);
  return html`<div class="diagram-summary">
<p class="detail">Text version: ${model.nodes.length} node(s), ${model.edges.length} relationship(s).</p>
<h4>Nodes</h4>
<ul>
${model.nodes.map((n) => html`<li${refAttrs(refs, n.id)}>${nodeBadge(n)}${n.label} <span class="kind">${n.kind}</span>${n.group ? html` <span class="kind">group ${n.group}</span>` : ''}${nodeDetail(n, ctx)}</li>
`)}</ul>
<h4>Relationships</h4>
${model.edges.length ? html`<ul>
${model.edges.map((e) => html`<li${refAttrs(refs, e.source, e.target)}>${name(e.source)} → ${name(e.target)} ${edgeDetail(e, ctx)}${e.source === e.target ? html` <span class="detail">(connects a node to itself; not drawn)</span>` : ''}</li>
`)}</ul>` : html`<p class="empty">No relationships to draw.</p>`}
${model.groups?.length ? groupSummary(model, labels) : ''}</div>`;
}

/** Every declared group, in declaration order, with its nodes; then the nodes in no group. */
function groupSummary(model, labels) {
  const grouped = new Set(model.groups.flatMap((g) => g.nodeIds));
  const loose = model.nodes.filter((n) => !grouped.has(n.id));
  return html`<h4>Groups</h4>
<p class="detail">Declared by this view to organize its nodes: not claims, no evidence, and not by themselves runtime, deployment or process boundaries.</p>
<ul>
${model.groups.map((g) => html`<li>${g.label} <span class="kind">group <code>${g.id}</code></span><p class="detail">${g.nodeIds.length ? html`${g.nodeIds.length} node(s): ${g.nodeIds.map((id, i) => html`${i ? ', ' : ''}${labels.get(id)}`)}.` : 'No node of this view is in this group, so no box is drawn.'}</p></li>
`)}</ul>
${loose.length ? html`<p class="detail">In no group (drawn without a box): ${loose.map((n, i) => html`${i ? ', ' : ''}${n.label}`)}.</p>
` : ''}`;
}

function nodeBadge(n) {
  if (n.impact === 'direct') return html`<span class="badge direct">direct</span> `;
  if (n.impact === 'derived') return html`<span class="badge derived">derived</span> `;
  return '';
}

function nodeDetail(n, ctx) {
  if (n.impact === 'derived') return html`<p class="detail">Derived: not a claim and not backed by evidence.</p>`;
  return html`<p class="detail">${n.impact === 'direct' ? html`Level <span class="badge level-${n.level}">${n.level}</span>, change ${n.changes.join(', ')}. ` : ''}${certaintyBadge(n)}${sources(n, ctx)}</p>`;
}

function edgeDetail(e, ctx) {
  if (e.basis === 'derived') {
    return html`<span class="badge derived">derived</span><p class="detail">Not a claim and not backed by evidence: follows relationship(s) ${e.via.map((id, i) => html`${i ? ', ' : ''}<code>${id}</code>`)}.</p>`;
  }
  return html`<span class="kind">${e.kind}</span> <span class="badge declared">declared</span>${e.label ? html`<div class="body">${e.label}</div>` : ''}<p class="detail">${certaintyBadge(e)}${sources(e, ctx)}</p>`;
}

function certaintyBadge(x) {
  return html`<span class="badge certainty-${x.certainty}">${x.certainty}</span> `;
}

function sources(x, ctx) {
  return x.evidenceIds.length ? html`Sources: ${ctx.sources(x.evidenceIds)}` : 'No evidence cited.';
}

function evidenceState(x, ctx) {
  if (x.evidenceIds.length === 0) return 'no evidence';
  return unverified(x, ctx) ? 'unverified' : `${x.evidenceIds.length} source(s)`;
}

function unverified(x, ctx) {
  return x.evidenceIds.some((id) => ctx.isStale(id));
}

/** Coordinates with one decimal, so the markup is short and stable. */
export function num(n) {
  return Math.round(n * 10) / 10;
}
