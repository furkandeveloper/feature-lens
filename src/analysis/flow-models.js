// Diagram models for execution flows, sequences, state machines and data
// flows: what their static diagrams draw, taken from one visualization of a
// manifest and nothing else. Pure like diagram-model.js: no I/O, clock,
// randomness or environment, and the manifest is never modified.
//
// Each type keeps its own semantics (message order, branch conditions,
// declared initial and terminal states, data vs. processing nodes), so each
// has its own model, tagged by `type`. None of them has derived items:
// every node and edge is declared in the manifest, and nothing is computed
// from them (no reachability, no transitive flow, no implied order).
//
// Order is manifest order. Edges have no id in the schema, so they are named
// by position (`next:<step>/<n>`, `message:<n>`, `transition:<n>`,
// `flow:<n>`, 1-based); `:` can't appear in a manifest id.

import { DiagramError, declaredClaim, dedupe, knownEvidence } from './diagram-model.js';

const MESSAGE_KINDS = new Set(['call', 'return', 'async', 'event']);
const DATA_NODE_KINDS = new Set(['source', 'process', 'store', 'sink', 'external']);

/**
 * A component a node stands for, by name. Its evidence is not borrowed.
 * @typedef {{ id: string, name: string }} ComponentRef
 */

/**
 * @typedef {object} FlowStep
 * @property {string} id
 * @property {string} label
 * @property {ComponentRef} [component]
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {string[]} evidenceIds
 * @property {boolean} start the flow's declared start step
 * @property {boolean} decision two or more next links
 * @property {boolean} end no next link: the schema's terminal step
 */

/**
 * A step's `next` entry. It has no claim of its own: it is part of the claim
 * of step `claimOf` (its source), whose certainty and evidence it shows.
 * @typedef {object} FlowLink
 * @property {string} id `next:<step>/<n>`
 * @property {string} source
 * @property {string} target
 * @property {string} [condition]
 * @property {string} claimOf
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {string[]} evidenceIds
 */

/**
 * @typedef {object} ExecutionFlowModel
 * @property {'executionFlow'} type
 * @property {string} id
 * @property {string} title
 * @property {string | null} start null only when there are no steps
 * @property {FlowStep[]} steps manifest order, which is not execution order
 * @property {FlowLink[]} links step order, then `next` order
 */

/**
 * @typedef {object} SequenceMessage
 * @property {string} id `message:<index>`
 * @property {number} index 1-based message order
 * @property {string} source sending participant
 * @property {string} target receiving participant
 * @property {string} label
 * @property {'call' | 'return' | 'async' | 'event'} kind
 * @property {boolean} self sent to its own sender
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {string[]} evidenceIds
 */

/**
 * @typedef {object} SequenceModel
 * @property {'sequence'} type
 * @property {string} id
 * @property {string} title
 * @property {{ id: string, label: string, component?: ComponentRef }[]} participants
 * @property {SequenceMessage[]} messages message order, never re-sorted
 */

/**
 * @typedef {object} StateTransition
 * @property {string} id `transition:<index>`
 * @property {number} index 1-based
 * @property {string} source
 * @property {string} target
 * @property {string} trigger
 * @property {string} [guard]
 * @property {boolean} self
 * @property {number} [repeats] index of an earlier transition with the same ends, trigger and guard
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {string[]} evidenceIds
 */

/**
 * @typedef {object} StateMachineModel
 * @property {'stateMachine'} type
 * @property {string} id
 * @property {string} title
 * @property {string} [subject]
 * @property {string | null} initial the declared initial state; never inferred
 * @property {string[]} terminals the declared terminal states; never inferred
 * @property {{ id: string, label: string, initial: boolean, terminal: boolean }[]} states
 * @property {StateTransition[]} transitions
 */

/**
 * @typedef {object} DataFlowEdge
 * @property {string} id `flow:<index>`
 * @property {number} index 1-based
 * @property {string} source
 * @property {string} target
 * @property {string} data what moves along the edge
 * @property {boolean} self
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {string[]} evidenceIds
 */

/**
 * @typedef {object} DataFlowModel
 * @property {'dataFlow'} type
 * @property {string} id
 * @property {string} title
 * @property {{ id: string, label: string, kind: 'source' | 'process' | 'store' | 'sink' | 'external', component?: ComponentRef }[]} nodes
 * @property {DataFlowEdge[]} flows
 */

/** @typedef {ExecutionFlowModel | SequenceModel | StateMachineModel | DataFlowModel} FlowDiagramModel */

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('../manifest/types.js').ExecutionFlow} flow
 * @returns {ExecutionFlowModel}
 * @throws {DiagramError} on anything that would make the diagram misleading
 */
export function executionFlowDiagram(manifest, flow) {
  const { where, evidence, component } = setup(manifest, flow, ['steps']);
  const steps = dedupe(flow.steps.map((s) => {
    const at = `${where}, step "${s?.id}"`;
    const base = named(s, at, 'step');
    if (s.next !== undefined && !Array.isArray(s.next)) throw new DiagramError(`${at}: next must be an array`);
    const next = (s.next ?? []).map((n, j) => {
      if (!nonEmpty(n?.to)) throw new DiagramError(`${at}: next ${j + 1} must name a step`);
      if (n.condition !== undefined && !nonEmpty(n.condition)) throw new DiagramError(`${at}: next ${j + 1} has an empty condition`);
      return { to: n.to, ...(n.condition !== undefined ? { condition: n.condition } : {}) };
    });
    return { ...base, ...component(s.componentId, at), ...claimOf(s, at, evidence), next };
  }), `${where}: step`);

  const ids = new Set(steps.map((s) => s.id));
  let start = null;
  if (steps.length > 0 || flow.start !== undefined) {
    if (!ids.has(flow.start)) throw new DiagramError(`${where}: start "${flow.start}" is not a step of the flow`);
    start = flow.start;
  }

  const links = steps.flatMap((s) => s.next.map((n, j) => {
    if (!ids.has(n.to)) throw new DiagramError(`${where}, step "${s.id}": next step "${n.to}" is not a step of the flow`);
    return {
      id: `next:${s.id}/${j + 1}`, source: s.id, target: n.to,
      ...(n.condition !== undefined ? { condition: n.condition } : {}),
      claimOf: s.id, certainty: s.certainty, evidenceIds: [...s.evidenceIds],
    };
  }));

  return {
    type: 'executionFlow', id: flow.id, title: flow.title, start,
    steps: steps.map(({ next, ...s }) => ({ ...s, start: s.id === start, decision: next.length > 1, end: next.length === 0 })),
    links,
  };
}

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('../manifest/types.js').Sequence} seq
 * @returns {SequenceModel}
 * @throws {DiagramError} on anything that would make the diagram misleading
 */
export function sequenceDiagram(manifest, seq) {
  const { where, evidence, component } = setup(manifest, seq, ['participants', 'messages']);
  const participants = dedupe(seq.participants.map((p) => {
    const at = `${where}, participant "${p?.id}"`;
    return { ...named(p, at, 'participant'), ...component(p.componentId, at) };
  }), `${where}: participant`);
  const ids = new Set(participants.map((p) => p.id));

  const messages = seq.messages.map((m, i) => {
    const at = `${where}, message ${i + 1}`;
    ends(m, at, ids, 'participant');
    if (!nonEmpty(m.label)) throw new DiagramError(`${at}: label must be a non-empty string`);
    if (!MESSAGE_KINDS.has(m.kind)) throw new DiagramError(`${at}: kind must be "call", "return", "async" or "event"`);
    return {
      id: `message:${i + 1}`, index: i + 1, source: m.from, target: m.to, label: m.label, kind: m.kind,
      self: m.from === m.to, ...claimOf(m, at, evidence),
    };
  });
  return { type: 'sequence', id: seq.id, title: seq.title, participants, messages };
}

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('../manifest/types.js').StateMachine} sm
 * @returns {StateMachineModel}
 * @throws {DiagramError} on anything that would make the diagram misleading
 */
export function stateMachineDiagram(manifest, sm) {
  const { where, evidence } = setup(manifest, sm, ['states', 'transitions']);
  if (sm.subject !== undefined && typeof sm.subject !== 'string') throw new DiagramError(`${where}: subject must be a string`);
  const states = dedupe(sm.states.map((s) => {
    const at = `${where}, state "${s?.id}"`;
    const base = named(s, at, 'state');
    for (const flag of ['initial', 'terminal']) {
      if (s[flag] !== undefined && typeof s[flag] !== 'boolean') throw new DiagramError(`${at}: ${flag} must be true or false`);
    }
    return { ...base, initial: s.initial === true, terminal: s.terminal === true };
  }), `${where}: state`);
  const ids = new Set(states.map((s) => s.id));
  const initial = states.filter((s) => s.initial);
  if (initial.length > 1) throw new DiagramError(`${where}: declares ${initial.length} initial states`);
  const terminals = states.filter((s) => s.terminal).map((s) => s.id);

  const first = new Map();
  const transitions = sm.transitions.map((t, i) => {
    const at = `${where}, transition ${i + 1}`;
    ends(t, at, ids, 'state');
    if (!nonEmpty(t.trigger)) throw new DiagramError(`${at}: trigger must be a non-empty string`);
    if (t.guard !== undefined && !nonEmpty(t.guard)) throw new DiagramError(`${at}: guard must be a non-empty string`);
    if (terminals.includes(t.from)) throw new DiagramError(`${at}: leaves terminal state "${t.from}"`);
    const key = JSON.stringify([t.from, t.to, t.trigger, t.guard ?? null]);
    const repeats = first.get(key);
    if (repeats === undefined) first.set(key, i + 1);
    return {
      id: `transition:${i + 1}`, index: i + 1, source: t.from, target: t.to, trigger: t.trigger,
      ...(t.guard !== undefined ? { guard: t.guard } : {}),
      self: t.from === t.to,
      ...(repeats !== undefined ? { repeats } : {}),
      ...claimOf(t, at, evidence),
    };
  });

  return {
    type: 'stateMachine', id: sm.id, title: sm.title,
    ...(sm.subject !== undefined ? { subject: sm.subject } : {}),
    initial: initial[0]?.id ?? null, terminals, states, transitions,
  };
}

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('../manifest/types.js').DataFlow} df
 * @returns {DataFlowModel}
 * @throws {DiagramError} on anything that would make the diagram misleading
 */
export function dataFlowDiagram(manifest, df) {
  const { where, evidence, component } = setup(manifest, df, ['nodes', 'flows']);
  const nodes = dedupe(df.nodes.map((n) => {
    const at = `${where}, node "${n?.id}"`;
    const base = named(n, at, 'node');
    if (!DATA_NODE_KINDS.has(n.kind)) throw new DiagramError(`${at}: kind must be "source", "process", "store", "sink" or "external"`);
    return { ...base, kind: n.kind, ...component(n.componentId, at) };
  }), `${where}: node`);
  const ids = new Set(nodes.map((n) => n.id));

  const flows = df.flows.map((f, i) => {
    const at = `${where}, flow ${i + 1}`;
    ends(f, at, ids, 'node');
    if (!nonEmpty(f.data)) throw new DiagramError(`${at}: data must be a non-empty string`);
    return {
      id: `flow:${i + 1}`, index: i + 1, source: f.from, target: f.to, data: f.data,
      self: f.from === f.to, ...claimOf(f, at, evidence),
    };
  });
  return { type: 'dataFlow', id: df.id, title: df.title, nodes, flows };
}

/** Checks shared by every type: id, title, the arrays it needs, and lookups into the manifest. */
function setup(manifest, v, arrays) {
  if (!nonEmpty(v?.id)) throw new DiagramError('diagram id must be a non-empty string');
  const where = `diagram "${v.id}"`;
  if (!nonEmpty(v.title)) throw new DiagramError(`${where}: title must be a non-empty string`);
  for (const key of arrays) {
    if (!Array.isArray(v[key])) throw new DiagramError(`${where}: ${key} must be an array`);
  }
  const components = new Map(manifest.analysis.components.map((c) => [c.id, c.name]));
  return {
    where,
    evidence: knownEvidence(manifest),
    /** `{ component }` for a node that names one, `{}` otherwise. */
    component(id, at) {
      if (id === undefined) return {};
      if (!components.has(id)) throw new DiagramError(`${at}: unknown component "${id}"`);
      return { component: { id, name: components.get(id) } };
    },
  };
}

function named(x, at, what) {
  if (!nonEmpty(x?.id)) throw new DiagramError(`${at}: ${what} id must be a non-empty string`);
  if (!nonEmpty(x.label)) throw new DiagramError(`${at}: label must be a non-empty string`);
  return { id: x.id, label: x.label };
}

function ends(e, at, ids, what) {
  if (e === null || typeof e !== 'object') throw new DiagramError(`${at}: must be an object`);
  if (!ids.has(e.from)) throw new DiagramError(`${at}: from "${e.from}" is not a ${what} of the diagram`);
  if (!ids.has(e.to)) throw new DiagramError(`${at}: to "${e.to}" is not a ${what} of the diagram`);
}

/** A manifest claim (`certainty`, `evidence`) as model fields. */
function claimOf(x, at, evidence) {
  if (!Array.isArray(x.evidence)) throw new DiagramError(`${at}: evidence must be an array`);
  const evidenceIds = declaredClaim({ certainty: x.certainty, evidenceIds: x.evidence }, at, evidence);
  return { certainty: x.certainty, evidenceIds };
}

function nonEmpty(s) {
  return typeof s === 'string' && s.length > 0;
}
