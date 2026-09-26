// Diagram models: the nodes and edges a static diagram draws, taken from a
// manifest and nothing else. Pure: no I/O, clock, randomness or environment,
// and the manifest is never modified. Nothing is inferred from source code:
// every node and edge is a manifest item, or (for derived impact) follows
// the manifest's declared relationships through buildImpactGraph.
//
// Order is manifest order, as everywhere in the renderer, so the same
// manifest always gives the same model. The model knows nothing about HTML.

import { buildImpactGraph, dependencyEnds } from './impact-graph.js';

export class DiagramError extends Error {}

const CERTAINTY_RANK = { unknown: 0, proposed: 1, inferred: 2, observed: 3 };
const EVIDENCE_REQUIRED = new Set(['observed', 'inferred']);
const LEVELS = new Set(['high', 'medium', 'low']);
const NODE_IMPACT = new Set(['direct', 'derived', null]);
const EDGE_BASIS = new Set(['declared', 'derived']);

/**
 * @typedef {object} DiagramNode
 * @property {string} id component id, or `file:<path>` for an impact item that names only a file
 * @property {string} label
 * @property {string} kind component kind, or "file"
 * @property {'direct' | 'derived' | null} impact direct: named by impact items (claims);
 *   derived: depends on something impacted, computed by FeatureLens (not a claim); null: not an impact diagram
 * @property {'high' | 'medium' | 'low'} [level] direct only: the strongest item level
 * @property {string[]} [changes] direct only: the items' `change` values
 * @property {import('../manifest/types.js').Certainty | null} certainty of the claim behind the node;
 *   for direct impact the weakest of its items; null when derived
 * @property {string[]} evidenceIds cited by that claim; always empty when derived
 * @property {string} [group] group label (architecture views); the group itself is in `DiagramModel.groups`
 */

/**
 * @typedef {object} DiagramEdge
 * @property {string} id relationship or impact relationship id; derived edges get
 *   `derived:["<source>","<target>"]`, which no manifest id can equal
 * @property {string} source node id
 * @property {string} target node id
 * @property {string} kind relationship kind, "impact", or "derived-impact"
 * @property {'declared' | 'derived'} basis declared: a claim in the manifest;
 *   derived: computed by FeatureLens from declared relationships, not a claim and not evidence-backed
 * @property {import('../manifest/types.js').Certainty | null} certainty null when derived
 * @property {string[]} evidenceIds always empty when derived
 * @property {string} [label]
 * @property {string[]} [via] derived only: the relationship ids the impact follows
 */

/**
 * A group declared by an architecture view, to organize its nodes. Not a
 * claim: it has no certainty or evidence, and says nothing about runtime,
 * deployment or process boundaries.
 * @typedef {object} DiagramGroup
 * @property {string} id the view's group id
 * @property {string} label
 * @property {string[]} nodeIds its nodes, in node order; empty when the view puts no node in it
 */

/**
 * @typedef {object} DiagramModel
 * @property {string} id
 * @property {string} title
 * @property {DiagramNode[]} nodes
 * @property {DiagramEdge[]} edges
 * @property {DiagramGroup[]} [groups] architecture views only, in declaration order
 */

/**
 * The impact diagram: every directly impacted node and every node with
 * derived impact. Declared edges are the manifest's impact relationships.
 * Derived edges run from a dependency that is impacted (directly or
 * derived) to a component that depends on it through a declared
 * relationship and has derived impact itself; they are exactly the steps
 * buildImpactGraph took to mark it.
 *
 * @param {import('../manifest/types.js').Manifest} manifest
 * @returns {DiagramModel}
 * @throws {DiagramError} when the manifest's impact data is inconsistent (it was not validated)
 */
export function impactDiagram(manifest) {
  const graph = buildImpactGraph(manifest);
  const items = new Map(manifest.analysis.impact.items.map((i) => [i.id, i]));
  const graphNodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const isImpacted = (id) => Boolean(graphNodes.get(id)?.impact || graphNodes.get(id)?.indirect);

  const nodes = graph.nodes.filter((n) => n.impact || n.indirect).map((n) => {
    if (!n.impact) {
      return { id: n.id, label: n.label, kind: n.kind, impact: 'derived', certainty: null, evidenceIds: [] };
    }
    const claims = n.impact.items.map((id) => items.get(id));
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      impact: 'direct',
      level: n.impact.level,
      changes: n.impact.changes,
      certainty: weakest(claims.map((c) => c.certainty)),
      evidenceIds: unique(claims.flatMap((c) => c.evidence)),
    };
  });

  const edges = graph.edges.filter((e) => e.type === 'impact').map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    kind: 'impact',
    basis: 'declared',
    certainty: e.certainty,
    evidenceIds: e.evidence,
    label: e.label,
  }));

  /** @type {Map<string, DiagramEdge>} */
  const derived = new Map();
  for (const r of manifest.analysis.relationships) {
    const [dependent, dependency] = dependencyEnds(r);
    const target = graphNodes.get(dependent);
    if (dependent === dependency || !target?.indirect || target.impact || !isImpacted(dependency)) continue;
    const id = `derived:${JSON.stringify([dependency, dependent])}`;
    const edge = derived.get(id);
    if (edge) edge.via.push(r.id);
    else derived.set(id, { id, source: dependency, target: dependent, kind: 'derived-impact', basis: 'derived', certainty: null, evidenceIds: [], via: [r.id] });
  }

  return buildDiagram({ id: 'impact', title: 'Impact diagram', nodes, edges: [...edges, ...derived.values()] }, knownEvidence(manifest));
}

/**
 * An architecture view as a diagram: its nodes are the view's components,
 * its edges the view's relationships, all declared claims.
 *
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('../manifest/types.js').ArchitectureView} view
 * @returns {DiagramModel}
 * @throws {DiagramError} when the view names a component, group or relationship the manifest lacks
 */
export function architectureDiagram(manifest, view) {
  const components = new Map(manifest.analysis.components.map((c) => [c.id, c]));
  const relationships = new Map(manifest.analysis.relationships.map((r) => [r.id, r]));
  const groups = new Map();
  for (const g of view.groups ?? []) {
    if (groups.has(g.id) && groups.get(g.id) !== g.label) throw new DiagramError(`diagram "${view.id}": group "${g.id}" is declared twice with different labels`);
    groups.set(g.id, g.label);
  }

  const nodes = view.nodes.map((n) => {
    const c = components.get(n.componentId);
    if (!c) throw new DiagramError(`diagram "${view.id}": unknown component "${n.componentId}"`);
    if (n.group !== undefined && !groups.has(n.group)) throw new DiagramError(`diagram "${view.id}": unknown group "${n.group}"`);
    return {
      id: c.id, label: c.name, kind: c.kind, impact: null, certainty: c.certainty, evidenceIds: c.evidence,
      ...(n.group !== undefined ? { group: groups.get(n.group) } : {}),
    };
  });
  const edges = view.edges.map((id) => {
    const r = relationships.get(id);
    if (!r) throw new DiagramError(`diagram "${view.id}": unknown relationship "${id}"`);
    return {
      id: r.id, source: r.from, target: r.to, kind: r.kind, basis: 'declared', certainty: r.certainty, evidenceIds: r.evidence,
      ...(r.label !== undefined ? { label: r.label } : {}),
    };
  });
  const members = view.nodes.filter((n) => n.group !== undefined);
  return buildDiagram({
    id: view.id, title: view.title, nodes, edges,
    groups: [...groups].map(([id, label]) => ({ id, label, nodeIds: unique(members.filter((n) => n.group === id).map((n) => n.componentId)) })),
  }, knownEvidence(manifest));
}

/**
 * Check a diagram and return a normalized copy (input order kept; the
 * input is not modified). A node or edge whose id repeats is dropped when
 * it is identical to the first one and refused otherwise.
 *
 * @param {{ id: string, title: string, nodes: object[], edges: object[] }} input
 * @param {Set<string>} evidence evidence ids known to the manifest
 * @returns {DiagramModel}
 * @throws {DiagramError} on anything that would make the diagram misleading
 */
export function buildDiagram(input, evidence) {
  const where = `diagram "${input?.id}"`;
  if (!nonEmpty(input?.id)) throw new DiagramError('diagram id must be a non-empty string');
  if (!nonEmpty(input.title)) throw new DiagramError(`${where}: title must be a non-empty string`);
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new DiagramError(`${where}: nodes and edges must be arrays`);

  const nodes = dedupe(input.nodes.map((n) => node(n, where, evidence)), `${where}: node`);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = dedupe(input.edges.map((e) => edge(e, where, evidence, nodeIds)), `${where}: edge`);
  if (input.groups === undefined) return { id: input.id, title: input.title, nodes, edges };
  return { id: input.id, title: input.title, nodes, edges, groups: groupList(input.groups, where, nodes) };
}

/**
 * Groups of an architecture view. Each node is in at most one group (the
 * schema gives a node one `group`), and a node's `group` label is its
 * group's label, so the text and the boxes can't disagree. Groups carry no
 * claim of their own.
 */
function groupList(input, where, nodes) {
  if (!Array.isArray(input)) throw new DiagramError(`${where}: groups must be an array`);
  const groups = dedupe(input.map((g) => {
    if (!nonEmpty(g?.id)) throw new DiagramError(`${where}: group id must be a non-empty string`);
    const at = `${where}, group "${g.id}"`;
    if (!nonEmpty(g.label)) throw new DiagramError(`${at}: label must be a non-empty string`);
    if (!Array.isArray(g.nodeIds) || !g.nodeIds.every(nonEmpty)) throw new DiagramError(`${at}: nodeIds must be an array of node ids`);
    for (const key of Object.keys(g)) {
      if (!['id', 'label', 'nodeIds'].includes(key)) throw new DiagramError(`${at}: a group has only an id, a label and nodes; "${key}" is not allowed`);
    }
    return { id: g.id, label: g.label, nodeIds: [...g.nodeIds] };
  }), `${where}: group`);
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const member = new Map();
  for (const g of groups) {
    for (const id of g.nodeIds) {
      const n = byNode.get(id);
      if (!n) throw new DiagramError(`${where}, group "${g.id}": "${id}" is not a node of the diagram`);
      if (member.has(id)) throw new DiagramError(`${where}: node "${id}" is in groups "${member.get(id)}" and "${g.id}"; a node is in at most one group`);
      member.set(id, g.id);
      if (n.group !== g.label) throw new DiagramError(`${where}, node "${id}": its group label does not match group "${g.id}"`);
    }
  }
  for (const n of nodes) {
    if (n.group !== undefined && !member.has(n.id)) throw new DiagramError(`${where}, node "${n.id}": group "${n.group}" is not one of the diagram's groups`);
  }
  return groups;
}

function node(n, where, evidence) {
  if (!nonEmpty(n?.id)) throw new DiagramError(`${where}: node id must be a non-empty string`);
  const at = `${where}, node "${n.id}"`;
  if (typeof n.label !== 'string') throw new DiagramError(`${at}: label must be a string`);
  if (!nonEmpty(n.kind)) throw new DiagramError(`${at}: kind must be a non-empty string`);
  if (!NODE_IMPACT.has(n.impact)) throw new DiagramError(`${at}: impact must be "direct", "derived" or null`);
  const evidenceIds = claim(n, at, evidence, n.impact === 'derived');
  if (n.impact === 'direct') {
    if (!LEVELS.has(n.level)) throw new DiagramError(`${at}: direct impact needs a level`);
    if (!Array.isArray(n.changes) || !n.changes.every(nonEmpty)) throw new DiagramError(`${at}: direct impact needs its changes`);
  } else if (n.level !== undefined || n.changes !== undefined) {
    throw new DiagramError(`${at}: level and changes belong to direct impact only`);
  }
  if (n.group !== undefined && !nonEmpty(n.group)) throw new DiagramError(`${at}: group must be a non-empty string`);
  return {
    id: n.id, label: n.label, kind: n.kind, impact: n.impact,
    ...(n.impact === 'direct' ? { level: n.level, changes: [...n.changes] } : {}),
    certainty: n.certainty, evidenceIds,
    ...(n.group !== undefined ? { group: n.group } : {}),
  };
}

function edge(e, where, evidence, nodeIds) {
  if (!nonEmpty(e?.id)) throw new DiagramError(`${where}: edge id must be a non-empty string`);
  const at = `${where}, edge "${e.id}"`;
  for (const end of ['source', 'target']) {
    if (!nodeIds.has(e[end])) throw new DiagramError(`${at}: ${end} "${e[end]}" is not a node of the diagram`);
  }
  if (!nonEmpty(e.kind)) throw new DiagramError(`${at}: kind must be a non-empty string`);
  if (!EDGE_BASIS.has(e.basis)) throw new DiagramError(`${at}: basis must be "declared" or "derived"`);
  const derived = e.basis === 'derived';
  const evidenceIds = claim(e, at, evidence, derived);
  if (derived && !(Array.isArray(e.via) && e.via.length > 0 && e.via.every(nonEmpty))) {
    throw new DiagramError(`${at}: a derived edge must name the relationships it follows`);
  }
  if (!derived && e.via !== undefined) throw new DiagramError(`${at}: only derived edges follow relationships`);
  if (e.label !== undefined && typeof e.label !== 'string') throw new DiagramError(`${at}: label must be a string`);
  return {
    id: e.id, source: e.source, target: e.target, kind: e.kind, basis: e.basis, certainty: e.certainty, evidenceIds,
    ...(e.label !== undefined ? { label: e.label } : {}),
    ...(derived ? { via: [...e.via] } : {}),
  };
}

/** Certainty and evidence of a node or edge. Derived items are computed, so they carry neither. */
function claim(item, at, evidence, derived) {
  if (!Array.isArray(item.evidenceIds)) throw new DiagramError(`${at}: evidenceIds must be an array`);
  if (derived) {
    if (item.certainty !== null) throw new DiagramError(`${at}: derived impact is not a claim and has no certainty`);
    if (item.evidenceIds.length > 0) throw new DiagramError(`${at}: derived impact cannot cite evidence`);
    return [];
  }
  return declaredClaim(item, at, evidence);
}

/**
 * Certainty and evidence of a declared claim: the certainty is known, every
 * evidence id is in the manifest, and observed and inferred cite some.
 * Shared with the other diagram models (src/analysis/flow-models.js).
 * @param {{ certainty: unknown, evidenceIds: unknown }} item
 * @param {string} at where the item is, for error messages
 * @param {Set<string>} evidence evidence ids known to the manifest
 * @returns {string[]} a copy of the evidence ids
 * @throws {DiagramError}
 */
export function declaredClaim(item, at, evidence) {
  if (!Array.isArray(item.evidenceIds)) throw new DiagramError(`${at}: evidenceIds must be an array`);
  if (!Object.hasOwn(CERTAINTY_RANK, item.certainty)) throw new DiagramError(`${at}: unknown certainty "${item.certainty}"`);
  for (const id of item.evidenceIds) {
    if (!evidence.has(id)) throw new DiagramError(`${at}: unknown evidence id "${id}"`);
  }
  if (EVIDENCE_REQUIRED.has(item.certainty) && item.evidenceIds.length === 0) {
    throw new DiagramError(`${at}: certainty "${item.certainty}" requires evidence`);
  }
  return [...item.evidenceIds];
}

/**
 * Keep the first of each id, in order. A repeat is dropped when its content
 * equals the first one's and refused otherwise.
 * @template {{ id: string }} T
 * @param {T[]} list
 * @param {string} what how to name an item in the error
 * @returns {T[]}
 */
export function dedupe(list, what) {
  const byId = new Map();
  const out = [];
  for (const x of list) {
    const seen = byId.get(x.id);
    if (seen === undefined) {
      byId.set(x.id, canonical(x));
      out.push(x);
    } else if (seen !== canonical(x)) {
      throw new DiagramError(`${what} "${x.id}" appears twice with different content`);
    }
  }
  return out;
}

/** JSON with object keys sorted, so equal content compares equal whatever the key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** @returns {Set<string>} the manifest's evidence ids */
export function knownEvidence(manifest) {
  return new Set(manifest.evidence.map((e) => e.id));
}

function weakest(certainties) {
  return certainties.reduce((a, b) => (CERTAINTY_RANK[b] < CERTAINTY_RANK[a] ? b : a));
}

function unique(list) {
  return [...new Set(list)];
}

function nonEmpty(s) {
  return typeof s === 'string' && s.length > 0;
}
