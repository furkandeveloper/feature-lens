// Node and edge integrity for the optional visualization types.

import { uniqueIds, reachable } from './report.js';

/**
 * @param {import('../manifest/types.js').Visualizations} viz
 * @param {import('./semantic.js').Context} ctx
 * @returns {Set<string>} all visualization ids, for section references
 */
export function checkVisualizations(viz, ctx) {
  const { report } = ctx;
  const all = new Set();
  for (const [type, views] of Object.entries(viz)) {
    views.forEach((v, i) => {
      if (all.has(v.id)) report.error('id.duplicate', `/visualizations/${type}/${i}/id`, `duplicate visualization id "${v.id}"`);
      all.add(v.id);
    });
  }

  (viz.architecture ?? []).forEach((v, i) => checkArchitecture(v, `/visualizations/architecture/${i}`, ctx));
  (viz.executionFlows ?? []).forEach((v, i) => checkExecutionFlow(v, `/visualizations/executionFlows/${i}`, ctx));
  (viz.sequences ?? []).forEach((v, i) => checkSequence(v, `/visualizations/sequences/${i}`, ctx));
  (viz.stateMachines ?? []).forEach((v, i) => checkStateMachine(v, `/visualizations/stateMachines/${i}`, ctx));
  (viz.dataFlows ?? []).forEach((v, i) => checkDataFlow(v, `/visualizations/dataFlows/${i}`, ctx));
  return all;
}

function componentRef(node, p, ctx) {
  if (node.componentId !== undefined) ctx.ref(ctx.ids.components, node.componentId, `${p}/componentId`, 'component');
}

/** Check `from`/`to` of each edge against `nodeIds` and the edge's own claim. */
function checkEdges(edges, p, nodeIds, what, ctx) {
  edges.forEach((e, i) => {
    const ep = `${p}/${i}`;
    ctx.ref(nodeIds, e.from, `${ep}/from`, what);
    ctx.ref(nodeIds, e.to, `${ep}/to`, what);
    ctx.claim(e, ep);
  });
}

function checkArchitecture(view, p, ctx) {
  const { report, manifest } = ctx;
  const groupIds = uniqueIds(view.groups ?? [], `${p}/groups`, report);
  const nodeIds = uniqueIds(view.nodes, `${p}/nodes`, report, 'componentId');
  view.nodes.forEach((n, i) => {
    componentRef(n, `${p}/nodes/${i}`, ctx);
    if (n.group !== undefined) ctx.ref(groupIds, n.group, `${p}/nodes/${i}/group`, 'group');
  });

  const relationships = new Map(manifest.analysis.relationships.map((r) => [r.id, r]));
  view.edges.forEach((id, i) => {
    const ep = `${p}/edges/${i}`;
    if (!ctx.ref(ctx.ids.relationships, id, ep, 'relationship')) return;
    const r = relationships.get(id);
    // Endpoints that are not components at all are already reported as ref.unknown.
    const missing = [r.from, r.to].filter((c) => ctx.ids.components.has(c) && !nodeIds.has(c));
    if (missing.length > 0) {
      report.error('graph.edge-outside-view', ep, `relationship "${id}" connects ${missing.map((c) => `"${c}"`).join(' and ')}, which ${missing.length > 1 ? 'are' : 'is'} not a node of this view`);
    }
  });
}

function checkExecutionFlow(flow, p, ctx) {
  const { report } = ctx;
  const stepIds = uniqueIds(flow.steps, `${p}/steps`, report);
  const startOk = ctx.ref(stepIds, flow.start, `${p}/start`, 'step');

  const next = new Map();
  flow.steps.forEach((s, i) => {
    const sp = `${p}/steps/${i}`;
    componentRef(s, sp, ctx);
    ctx.claim(s, sp);
    (s.next ?? []).forEach((n, j) => ctx.ref(stepIds, n.to, `${sp}/next/${j}/to`, 'step'));
    next.set(s.id, (s.next ?? []).map((n) => n.to));
  });

  if (startOk) warnUnreachable(flow.steps, reachable([flow.start], next), `${p}/steps`, `from start step "${flow.start}"`, report);
}

function checkSequence(seq, p, ctx) {
  const participantIds = uniqueIds(seq.participants, `${p}/participants`, ctx.report);
  seq.participants.forEach((n, i) => componentRef(n, `${p}/participants/${i}`, ctx));
  checkEdges(seq.messages, `${p}/messages`, participantIds, 'participant', ctx);
}

function checkStateMachine(sm, p, ctx) {
  const { report } = ctx;
  const stateIds = uniqueIds(sm.states, `${p}/states`, report);
  const initial = sm.states.filter((s) => s.initial);
  if (initial.length !== 1) {
    report.error('graph.initial-state', `${p}/states`, `state machine "${sm.id}" must have exactly one initial state, found ${initial.length}`);
  }
  checkEdges(sm.transitions, `${p}/transitions`, stateIds, 'state', ctx);

  const terminal = new Set(sm.states.filter((s) => s.terminal).map((s) => s.id));
  const next = new Map();
  sm.transitions.forEach((t, i) => {
    if (terminal.has(t.from)) {
      report.error('graph.terminal-outgoing', `${p}/transitions/${i}/from`, `terminal state "${t.from}" cannot have outgoing transitions`);
    }
    next.set(t.from, [...(next.get(t.from) ?? []), t.to]);
  });

  if (initial.length === 1) {
    warnUnreachable(sm.states, reachable([initial[0].id], next), `${p}/states`, `from initial state "${initial[0].id}"`, report);
  }
}

function checkDataFlow(df, p, ctx) {
  const nodeIds = uniqueIds(df.nodes, `${p}/nodes`, ctx.report);
  df.nodes.forEach((n, i) => componentRef(n, `${p}/nodes/${i}`, ctx));
  checkEdges(df.flows, `${p}/flows`, nodeIds, 'node', ctx);
}

function warnUnreachable(nodes, seen, p, from, report) {
  nodes.forEach((n, i) => {
    if (!seen.has(n.id)) report.warn('graph.unreachable', `${p}/${i}`, `"${n.id}" is not reachable ${from}`);
  });
}
