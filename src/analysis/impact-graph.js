// Builds the impact graph: the dependency graph from the analysis, annotated
// with impact items, plus the components that depend (transitively) on
// something directly impacted. A pure function of a valid manifest, so any
// renderer can draw it without knowing how the analysis is structured.

/**
 * For most relationship kinds `from` depends on `to` (a caller depends on
 * what it calls). For these, it's the other way around: whatever is
 * configured or receives the event depends on the source.
 */
const REVERSED = new Set(['configures', 'emits']);
const LEVEL_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Which end of a relationship depends on the other, the rule impact
 * propagation follows.
 * @param {{ from: string, to: string, kind: string }} r
 * @returns {[dependent: string, dependency: string]}
 */
export function dependencyEnds(r) {
  return REVERSED.has(r.kind) ? [r.to, r.from] : [r.from, r.to];
}

/**
 * @typedef {object} GraphNode
 * @property {string} id component id, or `file:<path>` for impact items that name only a file
 * @property {string} label
 * @property {string} kind component kind, or "file"
 * @property {string} [parent]
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {{ level: 'high' | 'medium' | 'low', changes: string[], items: string[] } | null} impact direct impact, strongest level wins
 * @property {boolean} indirect depends, directly or transitively, on a directly impacted node
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {'dependency' | 'impact'} type
 * @property {string} kind relationship kind, or "impact"
 * @property {string} [label]
 * @property {import('../manifest/types.js').Certainty} certainty
 * @property {string[]} evidence
 */

/**
 * @param {import('../manifest/types.js').Manifest} manifest a valid manifest
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[] }}
 */
export function buildImpactGraph(manifest) {
  const { components, relationships, impact } = manifest.analysis;

  /** @type {Map<string, GraphNode>} */
  const nodes = new Map(components.map((c) => [c.id, {
    id: c.id,
    label: c.name,
    kind: c.kind,
    ...(c.parent ? { parent: c.parent } : {}),
    certainty: c.certainty,
    impact: null,
    indirect: false,
  }]));

  const nodeOfItem = new Map();
  for (const item of impact.items) {
    const id = item.componentId ?? `file:${item.file}`;
    nodeOfItem.set(item.id, id);
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: item.file, kind: 'file', certainty: item.certainty, impact: null, indirect: false });
    }
    const node = nodes.get(id);
    const prev = node.impact;
    node.impact = {
      level: prev && LEVEL_RANK[prev.level] >= LEVEL_RANK[item.level] ? prev.level : item.level,
      changes: [...new Set([...(prev?.changes ?? []), item.change])],
      items: [...(prev?.items ?? []), item.id],
    };
  }

  /** @type {GraphEdge[]} */
  const edges = relationships.map((r) => ({
    id: r.id,
    from: r.from,
    to: r.to,
    type: 'dependency',
    kind: r.kind,
    ...(r.label ? { label: r.label } : {}),
    certainty: r.certainty,
    evidence: r.evidence,
  }));
  for (const r of impact.relationships) {
    edges.push({
      id: r.id,
      from: nodeOfItem.get(r.from),
      to: nodeOfItem.get(r.to),
      type: 'impact',
      kind: 'impact',
      label: r.reason,
      certainty: r.certainty,
      evidence: r.evidence,
    });
  }

  // Walk from each directly impacted node to whatever depends on it.
  const dependents = new Map();
  for (const r of relationships) {
    const [dependent, dependency] = dependencyEnds(r);
    dependents.set(dependency, [...(dependents.get(dependency) ?? []), dependent]);
  }
  const queue = [...nodes.values()].filter((n) => n.impact).map((n) => n.id);
  const seen = new Set(queue);
  while (queue.length > 0) {
    for (const id of dependents.get(queue.shift()) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.get(id).indirect = true;
      queue.push(id);
    }
  }

  return { nodes: [...nodes.values()], edges };
}
