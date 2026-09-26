// Layout for architecture views: layered like every other graph diagram,
// with group boxes and a bounded crossing-reduction heuristic. Pure and
// deterministic: no randomness, clock or environment, and the same model
// always gives the same coordinates. Geometry only; no HTML.
//
// 1. Layers: assignLayers (src/render/layers.js), unchanged: cycles are
//    broken by a depth-first walk in node order, self-loops are ignored.
// 2. Rows: each layer is a row of blocks. A block is an ungrouped node, or
//    a declared group's members on that layer. A group spans every layer
//    from its first member's to its last member's, and holds a block (maybe
//    empty) on each, so nothing else can be drawn inside its box. Groups
//    keep one left-to-right order across all rows.
// 3. Ordering: start from manifest order (nodes in view order, groups in
//    declaration order). Then at most MAX_ITERATIONS iterations of a
//    barycenter sweep down and up the layers: each block and each node
//    inside a group block moves toward the mean x of its neighbors on the
//    layers already swept, ties broken by current position (so, in the
//    end, by manifest order); then groups are reordered by the mean x of
//    all their neighbors. Crossings are counted before and after every
//    iteration and the ordering with the fewest is kept, earliest first, so
//    the result never has more crossings than manifest order.
// 4. Coordinates: every row's blocks are placed as far left as they can go
//    and as far right, subject to spacing and to each group having one x on
//    every layer it spans; each block takes the midpoint. A row without
//    groups is centered, exactly as in layoutDiagram.
//
// Cost for V nodes, E edges, L layers and G groups: each iteration is
// O(L·(V + E + L·G)) for the sweeps (placement is redone after each layer)
// plus O(E²) to count crossings. The number of iterations is fixed, and
// above MAX_PAIRS drawn edge pairs the heuristic is skipped and manifest
// order kept. It is a heuristic: it reduces crossings, it does not
// minimize them.

import { assignLayers, NODE_W, NODE_H, GAP_X, GAP_Y, MARGIN } from './layers.js';

/** Space between a group box and the nodes inside it. */
export const GROUP_PAD = 10;
/** Height of a group box's heading, above its first layer of nodes. */
export const GROUP_HEADER = 20;
/** Gap between layers when there are group boxes: room for a box's bottom, a gap and the next box's heading. */
export const GROUP_GAP_Y = 64;
/** Iterations of the ordering heuristic (each one sweep down and one up). */
export const MAX_ITERATIONS = 4;
/** Above this many distinct drawn node pairs, manifest order is kept and crossings are not counted. */
export const MAX_PAIRS = 1500;

/**
 * @typedef {object} ArchitectureLayout
 * @property {number} width
 * @property {number} height
 * @property {Map<string, { x: number, y: number, layer: number }>} boxes top-left corner of each node
 * @property {{ id: string, label: string, x: number, y: number, width: number, height: number, first: number, last: number }[]} groups
 *   boxes of the groups with at least one node, in declaration order; `first`/`last` are the layers spanned
 * @property {{ x: number, y: number }[][]} rows node boxes on each layer, left to right (for edge routing)
 * @property {{ before: number, after: number } | null} crossings between straight lines from
 *   node center to node center, in manifest order and as laid out; null when not counted
 * @property {number} iterations iterations of the heuristic that ran
 */

/**
 * @param {{ nodes: { id: string }[], edges: { source: string, target: string }[],
 *   groups?: { id: string, label: string, nodeIds: string[] }[] }} model
 * @param {{ iterations?: number }} [options] `iterations: 0` keeps manifest order (for comparison)
 * @returns {ArchitectureLayout}
 */
export function layoutArchitecture(model, { iterations = MAX_ITERATIONS } = {}) {
  const n = model.nodes.length;
  if (n === 0) return { width: 0, height: 0, boxes: new Map(), groups: [], rows: [], crossings: null, iterations: 0 };
  const index = new Map(model.nodes.map((node, i) => [node.id, i]));
  const layer = assignLayers(model);
  const depth = Math.max(...layer) + 1;

  // Groups that have nodes, in declaration order. A node is in at most one group.
  const groupOf = new Array(n).fill(-1);
  const groups = [];
  for (const g of model.groups ?? []) {
    const members = g.nodeIds.map((id) => index.get(id)).sort((a, b) => a - b);
    if (members.length === 0) continue;
    const gi = groups.length;
    for (const i of members) groupOf[i] = gi;
    const layers = members.map((i) => layer[i]);
    groups.push({ id: g.id, label: g.label, members, first: Math.min(...layers), last: Math.max(...layers) });
  }
  const boxed = groups.length > 0;
  const gapY = boxed ? GROUP_GAP_Y : GAP_Y;

  // Neighbors for barycenters: every drawn edge, both directions, once per pair.
  const pairs = new Map();
  for (const e of model.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!pairs.has(key)) pairs.set(key, [Math.min(a, b), Math.max(a, b)]);
  }
  const segments = [...pairs.values()];
  const neighbors = model.nodes.map(() => []);
  for (const [a, b] of segments) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  // Initial ordering: manifest order. Items are `n:<node>` or `g:<group>`.
  /** @type {{ rows: string[][], inside: number[][][], order: number[] }} */
  let state = {
    rows: [],
    inside: groups.map((g) => Array.from({ length: depth }, (_, d) => g.members.filter((i) => layer[i] === d))),
    order: groups.map((_, gi) => gi),
  };
  for (let d = 0; d < depth; d++) {
    const items = [];
    for (let i = 0; i < n; i++) if (layer[i] === d && groupOf[i] === -1) items.push({ item: `n:${i}`, key: i });
    groups.forEach((g, gi) => {
      if (g.first > d || g.last < d) return;
      const here = state.inside[gi][d];
      items.push({ item: `g:${gi}`, key: here.length ? here[0] : g.members[0] });
    });
    state.rows.push(withGroupOrder(items.sort((p, q) => p.key - q.key).map((x) => x.item), state.order));
  }

  const place = (s) => placeRows(s, groups, n, (gi) => {
    const widest = Math.max(...s.inside[gi].map((l) => l.length));
    return widest * NODE_W + (widest - 1) * GAP_X + 2 * GROUP_PAD;
  });

  let run = 0;
  let crossings = null;
  if (segments.length <= MAX_PAIRS) {
    let best = { state, count: countCrossings(place(state).center, layer, segments) };
    crossings = { before: best.count, after: best.count };
    let current = state;
    for (let it = 0; it < iterations && best.count > 0; it++) {
      const next = improve(current, { depth, layer, groups, groupOf, neighbors, place });
      run++;
      if (sameState(next, current)) break;
      current = next;
      const count = countCrossings(place(current).center, layer, segments);
      if (count < best.count) best = { state: current, count };
    }
    state = best.state;
    crossings.after = best.count;
  }

  // Coordinates.
  const { x, groupX, groupW, span } = place(state);
  const top = MARGIN + (groups.some((g) => g.first === 0) ? GROUP_PAD + GROUP_HEADER : 0);
  const bottom = MARGIN + (groups.some((g) => g.last === depth - 1) ? GROUP_PAD : 0);
  const rowY = (d) => top + d * (NODE_H + gapY);
  const boxes = new Map();
  model.nodes.forEach((node, i) => boxes.set(node.id, { x: MARGIN + x[i], y: rowY(layer[i]), layer: layer[i] }));
  const rows = Array.from({ length: depth }, () => []);
  model.nodes.forEach((node, i) => rows[layer[i]].push(boxes.get(node.id)));
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return {
    width: MARGIN * 2 + span,
    height: top + depth * NODE_H + (depth - 1) * gapY + bottom,
    boxes,
    groups: groups.map((g, gi) => ({
      id: g.id,
      label: g.label,
      x: MARGIN + groupX[gi],
      y: rowY(g.first) - GROUP_PAD - GROUP_HEADER,
      width: groupW[gi],
      height: (g.last - g.first + 1) * NODE_H + (g.last - g.first) * gapY + 2 * GROUP_PAD + GROUP_HEADER,
      first: g.first,
      last: g.last,
    })),
    rows,
    crossings,
    iterations: run,
  };
}

/** Put a row's group items in the global group order, keeping the places they hold in the row. */
function withGroupOrder(items, order) {
  const rank = new Map(order.map((gi, k) => [gi, k]));
  const present = items.filter((it) => it[0] === 'g').map((it) => Number(it.slice(2))).sort((a, b) => rank.get(a) - rank.get(b));
  let k = 0;
  return items.map((it) => (it[0] === 'g' ? `g:${present[k++]}` : it));
}

/**
 * x of every block: each row's blocks as far left and as far right as they
 * can go, then the midpoint. Constraints: consecutive blocks in a row are
 * at least GAP_X apart, and a group has one x on every layer it spans.
 * Groups are in the same order in every row, so the constraints have no
 * cycle. Returns node x (left edge, before MARGIN), node centers, group x
 * and widths, and the total width.
 */
function placeRows(state, groups, n, groupWidth) {
  // Variables: 0..n-1 ungrouped nodes (grouped ones unused), n+gi groups.
  const size = n + groups.length;
  const w = new Array(size).fill(NODE_W);
  groups.forEach((_, gi) => (w[n + gi] = groupWidth(gi)));
  const varOf = (item) => (item[0] === 'n' ? Number(item.slice(2)) : n + Number(item.slice(2)));
  const succ = Array.from({ length: size }, () => []);
  const pred = Array.from({ length: size }, () => []);
  const used = new Array(size).fill(false);
  for (const row of state.rows) {
    row.forEach((item, k) => {
      const v = varOf(item);
      used[v] = true;
      if (k > 0) {
        const u = varOf(row[k - 1]);
        succ[u].push(v);
        pred[v].push(u);
      }
    });
  }
  // Topological order (Kahn, first in first out).
  const indeg = pred.map((p) => p.length);
  const topo = [];
  for (let v = 0; v < size; v++) if (used[v] && indeg[v] === 0) topo.push(v);
  for (let k = 0; k < topo.length; k++) {
    for (const s of succ[topo[k]]) if (--indeg[s] === 0) topo.push(s);
  }
  const lo = new Array(size).fill(0);
  for (const v of topo) for (const s of succ[v]) lo[s] = Math.max(lo[s], lo[v] + w[v] + GAP_X);
  const span = Math.max(0, ...topo.map((v) => lo[v] + w[v]));
  const hi = new Array(size).fill(0);
  for (const v of [...topo].reverse()) {
    hi[v] = span - w[v];
    for (const s of succ[v]) hi[v] = Math.min(hi[v], hi[s] - w[v] - GAP_X);
  }
  const at = lo.map((l, v) => (l + hi[v]) / 2);

  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) x[i] = at[i];
  const groupX = groups.map((_, gi) => at[n + gi]);
  const groupW = groups.map((_, gi) => w[n + gi]);
  groups.forEach((_, gi) => {
    const inner = groupW[gi] - 2 * GROUP_PAD;
    for (const members of state.inside[gi]) {
      const row = members.length * NODE_W + (members.length - 1) * GAP_X;
      members.forEach((i, k) => (x[i] = groupX[gi] + GROUP_PAD + (inner - row) / 2 + k * (NODE_W + GAP_X)));
    }
  });
  const center = x.map((v) => v + NODE_W / 2);
  return { x, center, groupX, groupW, span };
}

/** One iteration: a sweep down, a sweep up, then groups reordered. Returns a new state. */
function improve(start, { depth, layer, groups, groupOf, neighbors, place }) {
  const s = copyState(start);
  const sweep = (d, side) => {
    const { center } = place(s);
    const key = (i) => {
      const ns = neighbors[i].filter((j) => side(layer[j]));
      return ns.length ? ns.reduce((a, j) => a + center[j], 0) / ns.length : center[i];
    };
    // Inside each group block: members by barycenter, ties by current order.
    const keys = new Map();
    for (const byLayer of s.inside) {
      const members = byLayer[d];
      const ranked = members.map((i, k) => ({ i, k, key: key(i) })).sort((p, q) => p.key - q.key || p.k - q.k);
      byLayer[d] = ranked.map((r) => r.i);
      for (const r of ranked) keys.set(r.i, r.key);
    }
    const { groupX, groupW } = place(s);
    const row = s.rows[d].map((item, k) => {
      if (item[0] === 'n') return { item, k, key: key(Number(item.slice(2))) };
      const gi = Number(item.slice(2));
      const members = s.inside[gi][d];
      const own = members.length ? members.reduce((a, i) => a + keys.get(i), 0) / members.length : groupX[gi] + groupW[gi] / 2;
      return { item, k, key: own };
    });
    s.rows[d] = withGroupOrder(row.sort((p, q) => p.key - q.key || p.k - q.k).map((r) => r.item), s.order);
  };
  for (let d = 1; d < depth; d++) sweep(d, (l) => l < d);
  for (let d = depth - 2; d >= 0; d--) sweep(d, (l) => l > d);

  if (groups.length > 1) {
    const { center, groupX, groupW } = place(s);
    const rank = s.order.map((gi, k) => {
      const ns = groups[gi].members.flatMap((i) => neighbors[i].filter((j) => groupOf[j] !== gi));
      return { gi, k, key: ns.length ? ns.reduce((a, j) => a + center[j], 0) / ns.length : groupX[gi] + groupW[gi] / 2 };
    }).sort((p, q) => p.key - q.key || p.k - q.k);
    s.order = rank.map((r) => r.gi);
    s.rows = s.rows.map((row) => withGroupOrder(row, s.order));
  }
  return s;
}

function copyState(s) {
  return { rows: s.rows.map((r) => [...r]), inside: s.inside.map((g) => g.map((l) => [...l])), order: [...s.order] };
}

function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Crossings between straight lines from node center to node center, each
 * pair of nodes counted once. Lines that share a node never count. O(E²).
 * @param {number[]} center x of each node's center
 * @param {number[]} layer layer of each node
 * @param {[number, number][]} segments node index pairs
 */
export function countCrossings(center, layer, segments) {
  const pts = segments.map(([a, b]) => [center[a], layer[a], center[b], layer[b]]);
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const [x1, y1, x2, y2] = pts[i];
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d] = segments[j];
      if (a === c || a === d || b === c || b === d) continue;
      const [x3, y3, x4, y4] = pts[j];
      // Lines whose layers overlap in at most one row could only meet at a node there.
      if (Math.max(y1, y2) <= Math.min(y3, y4) || Math.max(y3, y4) <= Math.min(y1, y2)) continue;
      if (properlyCross(x1, y1, x2, y2, x3, y3, x4, y4)) count++;
    }
  }
  return count;
}

function properlyCross(x1, y1, x2, y2, x3, y3, x4, y4) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const d1 = o(x3, y3, x4, y4, x1, y1);
  const d2 = o(x3, y3, x4, y4, x2, y2);
  const d3 = o(x1, y1, x2, y2, x3, y3);
  const d4 = o(x1, y1, x2, y2, x4, y4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Where a line from `from` to `to` (node boxes, top-left corners, on
 * different layers) should bend so it doesn't pass behind a node on a
 * layer in between: for each such layer that the straight line would cross
 * a node on, a vertical pass through the nearest gap between the nodes of
 * that layer (or beside them), from the layer's top to its bottom. Returns
 * [] when the straight line is clear. O(layers skipped × nodes on them).
 * @param {{ x: number, y: number, layer: number }} from
 * @param {{ x: number, y: number, layer: number }} to
 * @param {ArchitectureLayout} layout
 * @param {number} shift moves every bend this far sideways (opposite edges between the same nodes)
 * @returns {{ x: number, y: number }[]}
 */
export function bendsAround(from, to, layout, shift = 0) {
  if (Math.abs(from.layer - to.layer) < 2) return [];
  const a = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
  const b = { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 };
  const step = from.layer < to.layer ? 1 : -1;
  const xAt = (y) => a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
  const hits = (row, y0, y1) => row.some((box) => {
    const [l, r] = [Math.min(xAt(y0), xAt(y1)), Math.max(xAt(y0), xAt(y1))];
    return r > box.x - 4 && l < box.x + NODE_W + 4;
  });
  const layers = [];
  for (let d = from.layer + step; d !== to.layer; d += step) layers.push(d);
  const blocked = layers.some((d) => {
    const row = layout.rows[d];
    const y0 = row[0].y;
    return hits(row, y0, y0 + NODE_H);
  });
  if (!blocked) return [];
  const bends = [];
  for (const d of layers) {
    const row = layout.rows[d];
    const y0 = row[0].y;
    const want = xAt(y0 + NODE_H / 2);
    const gaps = [row[0].x - GAP_X / 2, ...row.slice(1).map((box, k) => (row[k].x + NODE_W + box.x) / 2), row.at(-1).x + NODE_W + GAP_X / 2];
    const free = gaps.reduce((best, g) => (Math.abs(g - want) < Math.abs(best - want) ? g : best));
    const [enter, leave] = step > 0 ? [y0, y0 + NODE_H] : [y0 + NODE_H, y0];
    bends.push({ x: free + shift, y: enter }, { x: free + shift, y: leave });
  }
  return bends;
}
