// Static SVG for execution flows, sequences, state machines and data flows
// (models from src/analysis/flow-models.js), each with a legend and a text
// version. Pure and deterministic like the rest of the renderer, and held
// to the same rules as src/render/diagram.js: no scripts, links, ids, url()
// references, inline styles or external resources, and every value escaped
// by `html`.
//
// Execution flows, state machines and data flows are graphs: they use the
// layered layout and arrows of diagram.js, with edge labels in the gap next
// to the source node and self-loops drawn at a node's lower-right corner.
// Sequences have their own layout: one column per participant, one row per
// message, in message order. The text version is the complete account of
// every diagram; the SVG only abbreviates it.

import { html } from './escape.js';
import { layoutDiagram, arrowBetween, wrapLabel, num, textVersion, NODE_W, NODE_H, GAP_Y, MARGIN } from './diagram.js';

/**
 * These diagrams scale down to fit only up to this width (one column of
 * nodes, or two participants); wider ones scroll inside their container.
 * Lower than diagram.js's FIT_WIDTH because their 11px edge and message
 * labels would become unreadable on a 390px screen at that scale.
 */
export const FLOW_FIT_WIDTH = 360;

/** Room kept to the right of and below the graph for self-loops. */
const LOOP_PAD = 24;
const EDGE_LABEL_CHARS = 20;
/** Gap between layers when edges carry labels: two rows of two-line labels. */
const LABEL_GAP_Y = 96;
/** Rough width of one character of an 11px edge label, for overlap checks. */
const LABEL_CHAR_W = 6.2;

const COL_W = 168;
const HEAD_W = 148;
const HEAD_H = 44;
const ROW_H = 56;
const SEQ_TOP = MARGIN + HEAD_H + 16;

const DATA_KIND = {
  source: 'data source',
  process: 'processing',
  store: 'data store',
  sink: 'destination',
  external: 'external system',
};

const DATA_KIND_MEANS = {
  source: 'where the data enters',
  process: 'transforms or routes data',
  store: 'holds data (declared as a store)',
  sink: 'where the data leaves',
  external: 'a system outside the codebase',
};

const MESSAGE_KIND = {
  call: 'Solid line, filled head: call.',
  return: 'Dashed line, open head: return (a reply to an earlier message).',
  async: 'Solid line, open head: async, sent without waiting for a reply. Nothing more about timing is implied.',
  event: 'Dotted line, filled head: event.',
};

/**
 * The diagram, its legend and its text version.
 * @param {import('../analysis/flow-models.js').FlowDiagramModel} model
 * @param {import('./diagram.js').DiagramRenderContext} ctx
 */
export function flowDiagram(model, ctx) {
  switch (model.type) {
    case 'executionFlow': return executionFlow(model, ctx);
    case 'sequence': return sequence(model, ctx);
    case 'stateMachine': return stateMachine(model, ctx);
    case 'dataFlow': return dataFlow(model, ctx);
    default: throw new TypeError(`unknown diagram type "${model.type}"`);
  }
}

// ── Execution flow ──────────────────────────────────────────────────────────

function executionFlow(m, ctx) {
  if (m.steps.length === 0) return html`<p class="empty">This flow has no steps.</p>`;
  const labels = new Map(m.steps.map((s) => [s.id, s.label]));
  const outgoing = (id) => m.links.filter((l) => l.source === id);
  const nodes = m.steps.map((s) => {
    const head = [s.start && 'start', s.decision && `decision · ${outgoing(s.id).length} ways`, s.end && 'no next step'].filter(Boolean).join(' · ') || 'step';
    const status = [head, `${s.certainty} · ${evidenceState(s, ctx)}`];
    return {
      id: s.id, label: s.label, shape: s.decision ? 'decision' : 'box', status,
      classes: ['node', 'step', s.start && 'start', s.decision && 'decision', s.end && 'end', unverified(s, ctx) && 'unverified'],
      tip: `${s.label}: ${status.join('; ')}${s.component ? `; component ${s.component.name}` : ''}`,
    };
  });
  const edges = m.links.map((l) => ({
    source: l.source, target: l.target, label: l.condition, unverified: unverified(l, ctx),
    tip: `${labels.get(l.source)} → ${labels.get(l.target)}${l.condition ? ` (condition: ${l.condition})` : ''}: part of the claim of step "${labels.get(l.claimOf)}", ${l.certainty}, ${evidenceState(l, ctx)}`,
  }));
  const svg = graph({ title: m.title, first: m.start, nodes, edges, noun: 'links', counts: `${m.steps.length} step(s) and ${m.links.length} link(s)` });

  const name = (id) => labels.get(id);
  return html`${svg}
<ul class="diagram-legend">
<li><span class="swatch node-start"></span> Thick border: the start step declared by the flow.</li>
<li>Pointed ends: a decision, a step with two or more next steps; each arrow carries its condition when one is given.</li>
<li><span class="swatch edge-declared"></span> Arrow: a next step declared by a step (part of that step's claim), with its condition if one is given.</li>
${staleLegend()}
</ul>
${textVersion(ctx, html`<div class="diagram-summary">
<p class="detail">Text version: ${m.steps.length} step(s), ${m.links.length} link(s). Start step: ${name(m.start)}. Steps are listed in manifest order; the order of execution is given only by the start step and the links.</p>
<h4>Steps</h4>
<ul>
${m.steps.map((s) => html`<li>${s.start ? html`<span class="badge start">start</span> ` : ''}${s.decision ? html`<span class="badge decision">decision</span> ` : ''}${s.label} <span class="kind">step <code>${s.id}</code></span>${componentDetail(s)}<p class="detail">${certaintyBadge(s)}${sources(s, ctx)}</p>${s.end ? html`<p class="detail">No next step is declared.</p>` : ''}</li>
`)}</ul>
<h4>Links</h4>
${m.links.length ? html`<ul>
${m.links.map((l) => {
  const decision = m.steps.find((s) => s.id === l.source).decision;
  return html`<li>${name(l.source)} → ${name(l.target)}${l.condition ? html` <span class="kind">condition: ${l.condition}</span>` : ''} <span class="badge declared">declared</span>${l.source === l.target ? html` <span class="detail">(links a step to itself)</span>` : ''}<p class="detail">Part of the claim of step ${name(l.claimOf)}: ${certaintyBadge(l)}${sources(l, ctx)}</p>${decision && !l.condition ? html`<p class="detail">No condition is given for this branch.</p>` : ''}</li>
`;
})}</ul>` : html`<p class="empty">No links are declared.</p>`}
</div>`)}`;
}

// ── State machine ───────────────────────────────────────────────────────────

function stateMachine(m, ctx) {
  if (m.states.length === 0) return html`<p class="empty">This state machine has no states.</p>`;
  const labels = new Map(m.states.map((s) => [s.id, s.label]));
  const trigger = (t) => `${t.trigger}${t.guard ? ` [${t.guard}]` : ''}`;
  const nodes = m.states.map((s) => {
    const loops = m.transitions.filter((t) => t.self && t.source === s.id).length;
    const head = [s.initial && 'initial', s.terminal && 'terminal'].filter(Boolean).join(' · ');
    const status = [head ? `${head} state` : 'state', loops ? `${loops} self-transition(s)` : ''];
    return {
      id: s.id, label: s.label, shape: 'round', status,
      classes: ['node', 'state', s.initial && 'initial', s.terminal && 'terminal'],
      tip: `${s.label}: ${status.filter(Boolean).join('; ')}`,
    };
  });
  const edges = m.transitions.map((t) => ({
    source: t.source, target: t.target, label: trigger(t), unverified: unverified(t, ctx),
    tip: `${t.index}. ${labels.get(t.source)} → ${labels.get(t.target)} on ${trigger(t)}: ${t.certainty}, ${evidenceState(t, ctx)}${t.repeats ? `; repeats transition ${t.repeats}` : ''}`,
  }));
  const svg = graph({ title: m.title, first: m.initial, nodes, edges, noun: 'transitions', counts: `${m.states.length} state(s) and ${m.transitions.length} transition(s)` });

  const name = (id) => labels.get(id);
  return html`${svg}
<ul class="diagram-legend">
${m.initial ? html`<li><span class="swatch node-start"></span> Thick border: the initial state, as declared.</li>
` : ''}${m.terminals.length ? html`<li><span class="swatch node-terminal"></span> Double border: a terminal state, as declared.</li>
` : ''}<li><span class="swatch edge-declared"></span> Arrow: a transition declared in the analysis (a claim), labelled with its trigger and [guard]. A loop at a state's corner is a transition back to the same state.</li>
${staleLegend()}
</ul>
${textVersion(ctx, html`<div class="diagram-summary">
<p class="detail">Text version: ${m.states.length} state(s), ${m.transitions.length} transition(s).${m.subject ? html` Subject: <code>${m.subject}</code>.` : ''} ${m.initial ? html`Initial state: ${name(m.initial)}.` : 'No initial state is declared.'} ${m.terminals.length ? html`Terminal state(s): ${m.terminals.map((id, i) => html`${i ? ', ' : ''}${name(id)}`)}.` : 'No terminal state is declared.'} Only declared transitions are shown; nothing here says which states are reachable.</p>
<h4>States</h4>
<ul>
${m.states.map((s) => html`<li>${s.initial ? html`<span class="badge initial">initial</span> ` : ''}${s.terminal ? html`<span class="badge terminal">terminal</span> ` : ''}${s.label} <span class="kind">state <code>${s.id}</code></span></li>
`)}</ul>
<h4>Transitions</h4>
${m.transitions.length ? html`<ul>
${m.transitions.map((t) => html`<li>${t.index}. ${name(t.source)} → ${name(t.target)} <span class="kind">on ${t.trigger}</span>${t.guard ? html` <span class="kind">guard ${t.guard}</span>` : ''} <span class="badge declared">declared</span>${t.self ? html` <span class="detail">(back to the same state)</span>` : ''}${t.repeats ? html` <span class="detail">(same ends, trigger and guard as transition ${t.repeats})</span>` : ''}<p class="detail">${certaintyBadge(t)}${sources(t, ctx)}</p></li>
`)}</ul>` : html`<p class="empty">No transitions are declared.</p>`}
</div>`)}`;
}

// ── Data flow ───────────────────────────────────────────────────────────────

function dataFlow(m, ctx) {
  if (m.nodes.length === 0) return html`<p class="empty">This data flow has no nodes.</p>`;
  const labels = new Map(m.nodes.map((n) => [n.id, n.label]));
  const shapes = { process: 'round', store: 'store' };
  const nodes = m.nodes.map((n) => {
    const loops = m.flows.filter((f) => f.self && f.source === n.id).length;
    const status = [DATA_KIND[n.kind], loops ? `${loops} flow(s) to itself` : ''];
    return {
      id: n.id, label: n.label, shape: shapes[n.kind] ?? 'box-square', status,
      classes: ['node', 'data', n.kind],
      tip: `${n.label}: ${status.filter(Boolean).join('; ')}${n.component ? `; component ${n.component.name}` : ''}`,
    };
  });
  const edges = m.flows.map((f) => ({
    source: f.source, target: f.target, label: f.data, unverified: unverified(f, ctx),
    tip: `${f.index}. ${labels.get(f.source)} → ${labels.get(f.target)}: ${f.data}; ${f.certainty}, ${evidenceState(f, ctx)}`,
  }));
  const svg = graph({ title: m.title, nodes, edges, noun: 'flows', counts: `${m.nodes.length} node(s) and ${m.flows.length} flow(s)` });

  const name = (id) => labels.get(id);
  return html`${svg}
<ul class="diagram-legend">
<li>Rounded box: processing. Box with a bar on its left: a data store. Square box: a data source, destination or external system. Each box also says its kind.</li>
<li><span class="swatch edge-declared"></span> Arrow: a flow declared in the analysis (a claim), from where the data comes to where it goes, labelled with the data.</li>
${staleLegend()}
</ul>
${textVersion(ctx, html`<div class="diagram-summary">
<p class="detail">Text version: ${m.nodes.length} node(s), ${m.flows.length} flow(s). Kinds are as declared; only a store is described as holding data.</p>
<h4>Nodes</h4>
<ul>
${m.nodes.map((n) => html`<li>${n.label} <span class="kind">${DATA_KIND[n.kind]}</span> <span class="kind">node <code>${n.id}</code></span><p class="detail">${capitalize(DATA_KIND[n.kind])}: ${DATA_KIND_MEANS[n.kind]}.</p>${componentDetail(n)}</li>
`)}</ul>
<h4>Flows</h4>
${m.flows.length ? html`<ul>
${m.flows.map((f) => html`<li>${f.index}. ${name(f.source)} → ${name(f.target)} <span class="badge declared">declared</span>${f.self ? html` <span class="detail">(back to the same node)</span>` : ''}<div class="body">${f.data}</div><p class="detail">${certaintyBadge(f)}${sources(f, ctx)}</p></li>
`)}</ul>` : html`<p class="empty">No flows are declared.</p>`}
</div>`)}`;
}

// ── Graph drawing (execution flows, state machines, data flows) ─────────────

/**
 * @param {{ title: string, counts: string, noun: string, first?: string | null,
 *   nodes: { id: string, label: string, shape: string, status: string[], classes: (string | false)[], tip: string }[],
 *   edges: { source: string, target: string, label?: string, unverified: boolean, tip: string }[] }} g
 */
function graph(g) {
  // Labelled edges get a taller gap between layers, with room for two rows of labels.
  const gapY = g.edges.some((e) => e.label) ? LABEL_GAP_Y : GAP_Y;
  const layout = layoutDiagram(g, g.first ?? undefined, gapY);
  const loops = new Map();
  const lines = new Map();
  for (const e of g.edges) {
    if (e.source === e.target) loops.set(e.source, [...(loops.get(e.source) ?? []), e]);
    else {
      const key = JSON.stringify([e.source, e.target]);
      lines.set(key, [...(lines.get(key) ?? []), e]);
    }
  }
  const arrows = [...lines.values()].map((es) => {
    const a = layout.boxes.get(es[0].source);
    const reverse = lines.has(JSON.stringify([es[0].target, es[0].source]));
    return { es, a, reverse, ...arrowBetween(a, layout.boxes.get(es[0].target), reverse) };
  });
  const labels = placeLabels(arrows, gapY, g.noun);
  const pad = loops.size ? LOOP_PAD : 0;
  const width = layout.width + pad;
  const height = layout.height + pad;
  return html`<div class="diagram-scroll">
<svg class="diagram ${width <= FLOW_FIT_WIDTH ? 'fit' : 'wide'}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${g.title}: ${g.counts}, listed in the text version below">
<title>${g.title}</title>
${arrows.map((w, i) => html`<g class="${edgeClasses(w.es)}">
<title>${tips(w.es)}</title>
<path class="line" d="${w.line}"></path>
<path class="head" d="${w.head}"></path>
${labels[i] ? edgeLabel(labels[i]) : ''}</g>
`)}${[...loops.values()].map((es) => loopShape(es, layout.boxes.get(es[0].source)))}${g.nodes.map((n) => graphNode(n, layout.boxes.get(n.id)))}</svg>
</div>`;
}

/**
 * Where each arrow's label goes: in the gap next to its source node, where
 * the line starts, on the line itself. A gap has two rows; each label takes
 * the first row where it overlaps no label already placed there, going left
 * to right, and the upper row when it overlaps in both. Deterministic: the
 * order is by position, then by arrow order.
 */
function placeLabels(arrows, gapY, noun) {
  const rows = [gapY * 0.3, gapY * 0.72];
  const wanted = arrows.map((w, i) => {
    const shown = w.es.find((e) => e.label)?.label;
    const base = w.es.length > 1 ? `${shown ? `${shown} ` : ''}(${shown ? `+${w.es.length - 1} more` : `${w.es.length} ${noun}`})` : shown;
    // Stale evidence is said in words on the line itself, not only by its style.
    const stale = w.es.some((e) => e.unverified);
    const text = stale ? `${base ? `${base} · ` : ''}unverified` : base;
    if (!text) return null;
    const lines = wrapLabel(text, EDGE_LABEL_CHARS, 2);
    const down = w.u.y > 0;
    const gapTop = down ? w.a.y + NODE_H : w.a.y - gapY;
    // Two opposite lines share a gap, so their labels go to either side.
    const anchor = !w.reverse ? 'middle' : w.p.x * w.off > 0 ? 'start' : 'end';
    const at = (y) => {
      const x = w.center.x + (w.u.x * (y - w.center.y)) / w.u.y + w.p.x * w.off;
      return anchor === 'middle' ? x : x + (anchor === 'start' ? 4 : -4);
    };
    const width = Math.max(...lines.map((l) => Array.from(l).length)) * LABEL_CHAR_W;
    const span = (x) => (anchor === 'middle' ? [x - width / 2, x + width / 2] : anchor === 'start' ? [x, x + width] : [x - width, x]);
    // Nearest the source first, so a label stays close to where its line starts.
    const order = down ? [0, 1] : [1, 0];
    return { i, lines, anchor, gapTop, order, at, span, key: at(gapTop + gapY / 2) };
  }).filter(Boolean);

  const placed = new Map();
  const out = [];
  for (const l of wanted.sort((p, q) => p.gapTop - q.gapTop || p.key - q.key || p.i - q.i)) {
    const options = l.order.map((r) => {
      const y = l.gapTop + rows[r];
      const x = l.at(y);
      const [from, to] = l.span(x);
      const taken = placed.get(`${l.gapTop}/${r}`) ?? [];
      return { r, x, y, from, to, free: taken.every(([f, t]) => to + 6 <= f || from >= t + 6) };
    });
    const pick = options.find((o) => o.free) ?? options[0];
    const key = `${l.gapTop}/${pick.r}`;
    placed.set(key, [...(placed.get(key) ?? []), [pick.from, pick.to]]);
    out[l.i] = { lines: l.lines, x: pick.x, y: pick.y, anchor: l.anchor };
  }
  return out;
}

function edgeLabel({ lines, x, y, anchor }) {
  const top = y + 4 - (lines.length - 1) * 6.5;
  return html`<text class="edge-label" x="${num(x)}" y="${num(top)}" text-anchor="${anchor}">${lines.map((l, i) => html`<tspan x="${num(x)}" dy="${i ? 13 : 0}">${l}</tspan>`)}</text>
`;
}

/** Edges from a node to itself: one loop at its lower-right corner, arriving upward at its bottom border. */
function loopShape(es, box) {
  const right = box.x + NODE_W;
  const bottom = box.y + NODE_H;
  const tip = { x: right - 26, y: bottom + 2 };
  const back = { x: tip.x, y: tip.y + 10 };
  const line = `M${num(right)} ${num(bottom - 24)}C${num(right + 26)} ${num(bottom - 24)} ${num(back.x)} ${num(back.y + 14)} ${num(back.x)} ${num(back.y)}`;
  const head = `M${num(tip.x)} ${num(tip.y)}L${num(back.x + 5)} ${num(back.y)}L${num(back.x - 5)} ${num(back.y)}Z`;
  return html`<g class="${edgeClasses(es)} loop">
<title>${tips(es)}</title>
<path class="line" d="${line}"></path>
<path class="head" d="${head}"></path>
</g>
`;
}

function graphNode(n, box) {
  const decision = n.shape === 'decision';
  const lines = wrapLabel(n.label, decision ? 20 : undefined);
  const cx = num(box.x + NODE_W / 2);
  const [x, y, r, b] = [box.x, box.y, box.x + NODE_W, box.y + NODE_H];
  let shape;
  if (decision) {
    shape = html`<path class="shape" d="M${num(x + 16)} ${num(y)}H${num(r - 16)}L${num(r)} ${num(y + NODE_H / 2)}L${num(r - 16)} ${num(b)}H${num(x + 16)}L${num(x)} ${num(y + NODE_H / 2)}Z"></path>`;
  } else {
    const rx = { round: 20, 'box-square': 0, store: 0 }[n.shape] ?? 6;
    shape = html`<rect x="${num(x)}" y="${num(y)}" width="${NODE_W}" height="${NODE_H}" rx="${rx}"></rect>`;
  }
  const extra = n.classes.includes('terminal')
    ? html`<rect class="inner" x="${num(x + 4)}" y="${num(y + 4)}" width="${NODE_W - 8}" height="${NODE_H - 8}" rx="16"></rect>
`
    : n.shape === 'store' ? html`<path class="mark" d="M${num(x + 12)} ${num(y)}V${num(b)}"></path>
` : '';
  const [status, detail] = n.status;
  return html`<g class="${n.classes.filter(Boolean).join(' ')}">
<title>${n.tip}</title>
${shape}
${extra}<text class="label" x="${cx}" y="${num(y + 20)}" text-anchor="middle">${lines.map((l, i) => html`<tspan x="${cx}" dy="${i ? 16 : 0}">${l}</tspan>`)}</text>
<text class="status" x="${cx}" y="${num(b - 22)}" text-anchor="middle">${status}</text>
${detail ? html`<text class="status" x="${cx}" y="${num(b - 8)}" text-anchor="middle">${detail}</text>
` : ''}</g>
`;
}

function edgeClasses(es) {
  return ['edge', 'declared', ...(es.some((e) => e.unverified) ? ['unverified'] : [])].join(' ');
}

function tips(es) {
  return html`${es.map((e, i) => html`${i ? '\n' : ''}${e.tip}`)}`;
}

// ── Sequence ────────────────────────────────────────────────────────────────

function sequence(m, ctx) {
  if (m.participants.length === 0) return html`<p class="empty">This sequence has no participants.</p>`;
  const column = new Map(m.participants.map((p, i) => [p.id, i]));
  const labels = new Map(m.participants.map((p) => [p.id, p.label]));
  const cx = (id) => MARGIN + column.get(id) * COL_W + COL_W / 2;
  const width = MARGIN * 2 + m.participants.length * COL_W;
  const bottom = SEQ_TOP + Math.max(m.messages.length * ROW_H, 24);
  const height = bottom + MARGIN;

  const svg = html`<div class="diagram-scroll">
<svg class="diagram sequence ${width <= FLOW_FIT_WIDTH ? 'fit' : 'wide'}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${m.title}: ${m.participants.length} participant(s) and ${m.messages.length} message(s) in order, listed in the text version below">
<title>${m.title}</title>
${m.participants.map((p) => {
  const x = cx(p.id);
  return html`<g class="participant">
<title>${p.label}${p.component ? ` (component ${p.component.name})` : ''}</title>
<rect x="${num(x - HEAD_W / 2)}" y="${MARGIN}" width="${HEAD_W}" height="${HEAD_H}" rx="4"></rect>
<text class="label" x="${num(x)}" y="${MARGIN + (wrapLabel(p.label, 18).length > 1 ? 18 : 26)}" text-anchor="middle">${wrapLabel(p.label, 18).map((l, i) => html`<tspan x="${num(x)}" dy="${i ? 16 : 0}">${l}</tspan>`)}</text>
<path class="lifeline" d="M${num(x)} ${MARGIN + HEAD_H}V${bottom}"></path>
</g>
`;
})}${m.messages.map((msg, k) => messageShape(msg, SEQ_TOP + k * ROW_H, cx, labels, ctx))}</svg>
</div>`;

  const name = (id) => labels.get(id);
  const kinds = [...new Set(m.messages.map((x) => x.kind))];
  return html`${svg}
<ul class="diagram-legend">
<li>Boxes and dashed lifelines: the participants, left to right in manifest order. Messages run top to bottom in message order, from the sender to the receiver (arrowhead); the number next to the sender is the message's position.</li>
${(kinds.length ? kinds : ['call']).map((kind) => html`<li><span class="swatch msg-${kind}"></span> ${MESSAGE_KIND[kind]}</li>
`)}<li>"unverified" after a label: the message cites stale evidence that has not been re-checked against the current code.</li>
</ul>
${textVersion(ctx, html`<div class="diagram-summary">
<p class="detail">Text version: ${m.participants.length} participant(s), ${m.messages.length} message(s), in message order.</p>
<h4>Participants</h4>
<ul>
${m.participants.map((p) => html`<li>${p.label} <span class="kind">participant <code>${p.id}</code></span>${componentDetail(p)}</li>
`)}</ul>
<h4>Messages</h4>
${m.messages.length ? html`<ol>
${m.messages.map((x) => html`<li>${name(x.source)} → ${name(x.target)}: ${x.label} <span class="kind">${x.kind}</span> <span class="badge declared">declared</span>${x.self ? html` <span class="detail">(to itself)</span>` : ''}<p class="detail">${certaintyBadge(x)}${sources(x, ctx)}</p></li>
`)}</ol>` : html`<p class="empty">No messages were recorded.</p>`}
</div>`)}`;
}

function messageShape(msg, y0, cx, labels, ctx) {
  const stale = unverified(msg, ctx);
  const from = cx(msg.source);
  const to = cx(msg.target);
  const text = `${msg.label}${msg.kind === 'call' ? '' : ` (${msg.kind})`}${stale ? ' · unverified' : ''}`;
  const open = msg.kind === 'return' || msg.kind === 'async';
  let line;
  let tip;
  let dir;
  let labelX;
  let chars;
  let number;
  if (msg.self) {
    // Out to the right, down, and back into the same lifeline.
    const y = y0 + 32;
    tip = { x: from + 2, y: y + 14 };
    dir = -1;
    line = `M${num(from)} ${num(y)}H${num(from + 28)}V${num(tip.y)}H${num(tip.x + 10)}`;
    labelX = from + 14;
    chars = Math.floor((COL_W - 24) / 7);
    number = { x: from + 32, y: tip.y + 4, anchor: 'start' };
  } else {
    const y = y0 + 40;
    dir = to > from ? 1 : -1;
    tip = { x: to - dir * 2, y };
    line = `M${num(from)} ${num(y)}H${num(tip.x - dir * 10)}`;
    labelX = (from + to) / 2;
    chars = Math.floor((Math.abs(to - from) - 16) / 7);
    number = { x: from + dir * 5, y: y - 4, anchor: dir > 0 ? 'start' : 'end' };
  }
  const bx = tip.x - dir * 10;
  const head = `M${num(bx)} ${num(tip.y - 5)}L${num(tip.x)} ${num(tip.y)}L${num(bx)} ${num(tip.y + 5)}${open ? '' : 'Z'}`;
  const lines = wrapLabel(text, chars, 2);
  const ly = y0 + (lines.length > 1 ? 10 : 24);
  return html`<g class="message ${msg.kind}${stale ? ' unverified' : ''}">
<title>${msg.index}. ${labels.get(msg.source)} → ${labels.get(msg.target)}: ${msg.label} (${msg.kind}); ${msg.certainty}, ${evidenceState(msg, ctx)}</title>
<path class="line" d="${line}"></path>
<path class="head${open ? ' open' : ''}" d="${head}"></path>
<text class="seq-index" x="${num(number.x)}" y="${num(number.y)}" text-anchor="${number.anchor}">${msg.index}</text>
<text class="edge-label" x="${num(labelX)}" y="${num(ly)}" text-anchor="middle">${lines.map((l, i) => html`<tspan x="${num(labelX)}" dy="${i ? 14 : 0}">${l}</tspan>`)}</text>
</g>
`;
}

// ── Shared text ─────────────────────────────────────────────────────────────

function staleLegend() {
  return html`<li><span class="swatch edge-unverified"></span> Dotted arrow, "unverified": cites stale evidence that has not been re-checked against the current code.</li>`;
}

function componentDetail(x) {
  return x.component ? html`<p class="detail">Component: ${x.component.name} <span class="kind"><code>${x.component.id}</code></span></p>` : '';
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

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}
