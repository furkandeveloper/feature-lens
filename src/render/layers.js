// Layer assignment and node sizes shared by every layered diagram
// (src/render/diagram.js, src/render/flow-diagram.js and
// src/render/architecture-layout.js). Pure and deterministic.

export const NODE_W = 200;
export const NODE_H = 72;
export const GAP_X = 24;
export const GAP_Y = 56;
export const MARGIN = 12;

/**
 * The layer of each node, by node index. Depth-first in node order (after
 * `first`, when given); an edge to a node still on the stack closes a cycle
 * and is ignored for layering. Reverse postorder is then a topological order
 * of the remaining edges, and each node goes one layer below the deepest
 * node pointing at it. Self-loops are ignored. O(V + E).
 * @param {{ nodes: { id: string }[], edges: { source: string, target: string }[] }} model
 * @param {string} [first]
 * @returns {number[]}
 */
export function assignLayers(model, first) {
  const index = new Map(model.nodes.map((n, i) => [n.id, i]));
  const out = model.nodes.map(() => []);
  for (const e of model.edges) {
    if (e.source !== e.target) out[index.get(e.source)].push(index.get(e.target));
  }

  const state = new Array(model.nodes.length).fill(0);
  const kept = model.nodes.map(() => []);
  const post = [];
  const roots = model.nodes.map((_, i) => i);
  if (index.has(first)) roots.unshift(index.get(first));
  for (const root of roots) {
    if (state[root]) continue;
    const stack = [[root, 0]];
    state[root] = 1;
    while (stack.length) {
      const top = stack.at(-1);
      const [v, i] = top;
      if (i < out[v].length) {
        top[1]++;
        const w = out[v][i];
        if (state[w] === 1) continue;
        kept[v].push(w);
        if (state[w] === 0) {
          state[w] = 1;
          stack.push([w, 0]);
        }
      } else {
        state[v] = 2;
        post.push(v);
        stack.pop();
      }
    }
  }
  const layer = new Array(model.nodes.length).fill(0);
  for (const v of post.reverse()) {
    for (const w of kept[v]) layer[w] = Math.max(layer[w], layer[v] + 1);
  }
  return layer;
}
