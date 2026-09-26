import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { architectureDiagram, impactDiagram, buildDiagram, DiagramError } from '../src/analysis/diagram-model.js';
import { layoutDiagram, diagram, FIT_WIDTH, NODE_W, NODE_H } from '../src/render/diagram.js';
import { layoutArchitecture, countCrossings, bendsAround, GROUP_PAD, GROUP_HEADER, MAX_ITERATIONS, MAX_PAIRS } from '../src/render/architecture-layout.js';
import { render, RenderError } from '../src/render/render.js';
import { escapeHtml } from '../src/render/escape.js';
import { validateManifest } from '../src/validation/validate.js';
import { sampleManifest, minimalManifest } from './helpers.js';

const PAYLOAD = `<img src=x onerror="alert(1)">'&</text><script>alert(2)</script><!-- featurelens {} -->`;
const claim = { certainty: 'proposed', evidence: [] };

/**
 * A valid manifest with one architecture view, listed by a generated
 * architecture section. `nodes` are [componentId, groupId?]; `edges` are
 * [id, from, to]; components and relationships are created for them.
 */
function viewManifest({ groups = [], nodes, edges = [] }) {
  const m = minimalManifest();
  m.analysis.components = nodes.map(([id]) => ({ id, name: id.toUpperCase(), kind: 'module', summary: id, ...claim }));
  m.analysis.relationships = edges.map(([id, from, to]) => ({ id, from, to, kind: 'calls', ...claim }));
  m.visualizations.architecture = [{
    id: 'v', title: 'View', groups,
    nodes: nodes.map(([componentId, group]) => (group ? { componentId, group } : { componentId })),
    edges: edges.map(([id]) => id),
  }];
  m.documentation.sections.push({ id: 'arch', title: 'Architecture', kind: 'architecture', origin: 'generated', visualizations: ['v'], provenance: { historyId: 'h-1' } });
  m.history[0].changedSections.push('arch');
  return m;
}

const model = (m) => architectureDiagram(m, m.visualizations.architecture[0]);

function archHtml(out, title = 'View') {
  const start = out.indexOf(`<figure class="viz">\n<figcaption>${title} <span class="kind">Architecture view</span>`);
  assert.notEqual(start, -1, `architecture view ${title} rendered`);
  return out.slice(start, out.indexOf('</figure>', start));
}
const svgOf = (text) => text.slice(text.indexOf('<svg'), text.indexOf('</svg>') + 6);

/** Deterministic pseudo-random numbers (a fixed LCG), so generated graphs are the same on every run. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A plain nodes-and-edges graph for the layout, with optional groups of node ids. */
function graph(ids, pairs, groups) {
  return {
    nodes: ids.map((id) => ({ id })),
    edges: pairs.map(([source, target]) => ({ source, target })),
    ...(groups ? { groups: Object.entries(groups).map(([id, nodeIds]) => ({ id, label: id, nodeIds })) } : {}),
  };
}

function randomGraph(seed, n, e, groupCount = 0) {
  const rnd = lcg(seed);
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const pairs = [];
  for (let k = 0; k < e; k++) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    pairs.push([ids[a], ids[b]]);
  }
  let groups;
  if (groupCount) {
    groups = {};
    ids.forEach((id) => {
      const g = Math.floor(rnd() * (groupCount + 1));
      if (g < groupCount) (groups[`g${g}`] ??= []).push(id);
    });
  }
  return graph(ids, pairs, groups);
}

/** Crossings of a layout, counted the same way as the heuristic does, from its boxes. */
function crossingsOf(g, layout) {
  const index = new Map(g.nodes.map((n, i) => [n.id, i]));
  const center = g.nodes.map((n) => layout.boxes.get(n.id).x + NODE_W / 2);
  const layer = g.nodes.map((n) => layout.boxes.get(n.id).layer);
  const seen = new Map();
  for (const e of g.edges) {
    const [a, b] = [index.get(e.source), index.get(e.target)];
    if (a !== b) seen.set(`${Math.min(a, b)},${Math.max(a, b)}`, [a, b]);
  }
  return countCrossings(center, layer, [...seen.values()]);
}

const inside = (n, b) => n.x >= b.x && n.y >= b.y && n.x + NODE_W <= b.x + b.width && n.y + NODE_H <= b.y + b.height;
const overlaps = (n, b) => n.x < b.x + b.width && b.x < n.x + NODE_W && n.y < b.y + b.height && b.y < n.y + NODE_H;

describe('architecture groups: the model', () => {
  test('groups come from the view only: declared order, stable ids, labels and members; nodes keep their claims', () => {
    const m = sampleManifest();
    const d = model(m);
    assert.deepEqual(d.groups, [
      { id: 'http', label: 'HTTP', nodeIds: ['pay-route'] },
      { id: 'domain', label: 'Domain', nodeIds: ['payment-service'] },
      { id: 'data', label: 'Data access', nodeIds: ['order-repo', 'payment-repo', 'payment-record'] },
      { id: 'external', label: 'External', nodeIds: ['gateway-client', 'card-gateway'] },
    ]);
    for (const g of d.groups) assert.deepEqual(Object.keys(g), ['id', 'label', 'nodeIds'], 'a group has no certainty or evidence');
    const route = d.nodes.find((n) => n.id === 'pay-route');
    const component = m.analysis.components.find((c) => c.id === 'pay-route');
    assert.equal(route.certainty, component.certainty);
    assert.deepEqual(route.evidenceIds, component.evidence, 'group membership does not change evidence');
  });

  test('ungrouped nodes, empty groups and views without groups', () => {
    const m = viewManifest({ groups: [{ id: 'g2', label: 'Second' }, { id: 'g1', label: 'First' }, { id: 'none', label: 'Empty' }], nodes: [['a', 'g1'], ['b'], ['c', 'g2'], ['d', 'g1']] });
    assert.equal(validateManifest(m).valid, true);
    const d = model(m);
    assert.deepEqual(d.groups, [
      { id: 'g2', label: 'Second', nodeIds: ['c'] },
      { id: 'g1', label: 'First', nodeIds: ['a', 'd'] },
      { id: 'none', label: 'Empty', nodeIds: [] },
    ], 'declaration order, members in node order, empty groups kept');
    assert.equal(d.nodes.find((n) => n.id === 'b').group, undefined);
    assert.deepEqual(model(viewManifest({ nodes: [['a']] })).groups, []);
    assert.equal(impactDiagram(sampleManifest()).groups, undefined, 'the impact model is unchanged');
  });

  test('a node is in at most one group; groups and node labels must agree', () => {
    const nodes = [{ id: 'a', label: 'A', kind: 'module', impact: null, certainty: 'proposed', evidenceIds: [], group: 'G' }, { id: 'b', label: 'B', kind: 'module', impact: null, certainty: 'proposed', evidenceIds: [] }];
    const ok = (groups) => buildDiagram({ id: 'd', title: 'D', nodes, edges: [], groups }, new Set());
    const bad = (re, groups) => assert.throws(() => ok(groups), (e) => e instanceof DiagramError && re.test(e.message));
    assert.deepEqual(ok([{ id: 'g', label: 'G', nodeIds: ['a'] }]).groups, [{ id: 'g', label: 'G', nodeIds: ['a'] }]);
    bad(/node "a" is in groups "g" and "h"; a node is in at most one group/, [{ id: 'g', label: 'G', nodeIds: ['a'] }, { id: 'h', label: 'G', nodeIds: ['a'] }]);
    bad(/"zz" is not a node of the diagram/, [{ id: 'g', label: 'G', nodeIds: ['a', 'zz'] }]);
    bad(/its group label does not match group "g"/, [{ id: 'g', label: 'Other', nodeIds: ['a'] }]);
    bad(/group "G" is not one of the diagram's groups/, []);
    bad(/its group label does not match group "g"/, [{ id: 'g', label: 'G', nodeIds: ['a', 'b'] }]);
    bad(/"evidence" is not allowed/, [{ id: 'g', label: 'G', nodeIds: ['a'], evidence: ['ev'] }]);
    bad(/label must be a non-empty string/, [{ id: 'g', label: '', nodeIds: ['a'] }]);
    bad(/group id must be a non-empty string/, [{ label: 'G', nodeIds: ['a'] }]);
    bad(/group "g" appears twice with different content/, [{ id: 'g', label: 'G', nodeIds: ['a'] }, { id: 'g', label: 'G', nodeIds: [] }]);
    assert.equal(ok([{ id: 'g', label: 'G', nodeIds: ['a'] }, { id: 'g', label: 'G', nodeIds: ['a'] }]).groups.length, 1, 'an identical repeat is dropped');
  });

  test('a view declaring one group id twice with different labels is refused', () => {
    const m = viewManifest({ groups: [{ id: 'g', label: 'One' }, { id: 'g', label: 'Two' }], nodes: [['a', 'g']] });
    assert.throws(() => model(m), /group "g" is declared twice with different labels/);
    assert.throws(() => render(m, { excerpts: [], stale: [] }), RenderError);
  });

  test('the schema gives a node one group, so multiple membership cannot be declared', () => {
    const m = viewManifest({ groups: [{ id: 'g', label: 'G' }], nodes: [['a', 'g']] });
    m.visualizations.architecture[0].nodes[0].group = ['g', 'h'];
    assert.equal(validateManifest(m).valid, false);
  });
});

describe('architecture layout: crossing reduction', () => {
  test('an avoidable crossing is removed; manifest order is what iterations: 0 gives', () => {
    const g = graph(['a1', 'a2', 'b1', 'b2'], [['a1', 'b2'], ['a2', 'b1']]);
    const before = layoutArchitecture(g, { iterations: 0 });
    const after = layoutArchitecture(g);
    assert.deepEqual(before.crossings, { before: 1, after: 1 });
    assert.deepEqual(after.crossings, { before: 1, after: 0 });
    assert.equal(crossingsOf(g, before), 1);
    assert.equal(crossingsOf(g, after), 0);
    assert.ok(after.boxes.get('b2').x < after.boxes.get('b1').x);
    // The layout that architecture views used before (layoutDiagram) keeps the crossing.
    assert.equal(crossingsOf(g, layoutDiagram(g)), 1);
  });

  test('never more crossings than manifest order, on many generated graphs, with and without groups', () => {
    let improved = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = randomGraph(seed, 6 + (seed % 14), 8 + (seed % 25), seed % 4);
      const base = layoutArchitecture(g, { iterations: 0 });
      const l = layoutArchitecture(g);
      assert.equal(l.crossings.before, base.crossings.after, `seed ${seed}`);
      assert.ok(l.crossings.after <= l.crossings.before, `seed ${seed}: ${l.crossings.after} > ${l.crossings.before}`);
      assert.equal(crossingsOf(g, l), l.crossings.after, `seed ${seed}: reported count matches the coordinates`);
      assert.ok(l.iterations <= MAX_ITERATIONS);
      if (l.crossings.after < l.crossings.before) improved++;
    }
    assert.ok(improved >= 10, `the heuristic helps on a fair share of graphs (${improved}/60)`);
  });

  test('stable: identical input gives identical output, and the input is not modified', () => {
    const g = randomGraph(7, 30, 50, 3);
    const copy = structuredClone(g);
    const a = layoutArchitecture(g);
    for (let i = 0; i < 5; i++) assert.deepEqual(layoutArchitecture(structuredClone(g)), a);
    assert.deepEqual(g, copy);
  });

  test('ties keep manifest order', () => {
    // Every order has the same number of crossings (none): nothing moves.
    const g = graph(['r', 'x', 'y', 'z'], [['r', 'x'], ['r', 'y'], ['r', 'z']]);
    const l = layoutArchitecture(g);
    assert.deepEqual(l.crossings, { before: 0, after: 0 });
    assert.ok(l.boxes.get('x').x < l.boxes.get('y').x && l.boxes.get('y').x < l.boxes.get('z').x);
    // A crossing that swapping cannot remove: manifest order is kept, not an equal alternative.
    const k = graph(['a', 'b', 'c', 'd'], [['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd']]);
    const lk = layoutArchitecture(k);
    assert.deepEqual(lk.crossings, { before: 1, after: 1 });
    assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => lk.boxes.get(id).x), ['a', 'b', 'c', 'd'].map((id) => layoutArchitecture(k, { iterations: 0 }).boxes.get(id).x));
  });

  test('without groups and with nothing to improve, positions are exactly those of the previous layout', () => {
    for (const g of [
      graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['a', 'c'], ['a', 'd']]),
      graph(['a'], []),
      graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a'], ['b', 'b']]),
    ]) {
      const old = layoutDiagram(g);
      const now = layoutArchitecture(g);
      assert.equal(now.crossings.after, 0);
      assert.deepEqual([now.width, now.height, now.boxes], [old.width, old.height, old.boxes]);
    }
  });

  test('cycles, self-loops, parallel edges and disconnected components terminate with valid output', () => {
    const g = graph(['a', 'b', 'c', 'd', 'e', 'f', 'lone'],
      [['a', 'b'], ['b', 'c'], ['c', 'a'], ['a', 'a'], ['a', 'b'], ['b', 'a'], ['d', 'e'], ['e', 'f'], ['d', 'f']],
      { g1: ['a', 'b'], g2: ['e', 'lone'] });
    const l = layoutArchitecture(g);
    assert.equal(l.boxes.size, 7, 'every node is placed');
    assert.deepEqual(['a', 'b', 'c'].map((id) => l.boxes.get(id).layer), [0, 1, 2], 'the cycle is broken by the walk in node order');
    assert.equal(l.boxes.get('lone').layer, 0);
    const all = [...l.boxes.values()];
    for (const [i, p] of all.entries()) {
      for (const q of all.slice(i + 1)) assert.ok(!(p.layer === q.layer && Math.abs(p.x - q.x) < NODE_W), 'no two nodes overlap');
    }
    assert.deepEqual(layoutArchitecture(structuredClone(g)), l);
  });

  test('bounded: a large graph is laid out quickly with a fixed number of iterations', () => {
    const g = randomGraph(99, 400, 700, 12);
    const started = process.hrtime.bigint();
    const l = layoutArchitecture(g);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(l.boxes.size, 400);
    assert.ok(l.iterations <= MAX_ITERATIONS);
    assert.ok(l.crossings.after <= l.crossings.before);
    assert.ok(ms < 5000, `took ${ms}ms`);
  });

  test('above MAX_PAIRS drawn pairs the heuristic is skipped and manifest order kept', () => {
    const ids = Array.from({ length: 80 }, (_, i) => `n${i}`);
    const pairs = [];
    for (let a = 0; a < 40 && pairs.length <= MAX_PAIRS; a++) for (let b = 40; b < 80; b++) pairs.push([ids[a], ids[b]]);
    assert.ok(pairs.length > MAX_PAIRS);
    const l = layoutArchitecture(graph(ids, pairs));
    assert.equal(l.crossings, null);
    assert.equal(l.iterations, 0);
    assert.deepEqual(l.boxes, layoutArchitecture(graph(ids, pairs), { iterations: 0 }).boxes);
  });

  test('countCrossings counts proper crossings only', () => {
    // n0 n1 on layer 0, n2 n3 on layer 1.
    const center = [0, 10, 0, 10];
    const layer = [0, 0, 1, 1];
    assert.equal(countCrossings(center, layer, [[0, 3], [1, 2]]), 1);
    assert.equal(countCrossings(center, layer, [[0, 2], [1, 3]]), 0);
    assert.equal(countCrossings(center, layer, [[0, 3], [0, 2]]), 0, 'lines sharing a node do not cross');
    assert.equal(countCrossings([0, 5, 10], [0, 1, 2], [[0, 1], [1, 2]]), 0);
  });
});

describe('architecture layout: group boxes', () => {
  function checkBoxes(g, l) {
    const members = new Map((g.groups ?? []).flatMap((x) => x.nodeIds.map((id) => [id, x.id])));
    for (const box of l.groups) {
      for (const [id, n] of l.boxes) {
        if (members.get(id) === box.id) {
          assert.ok(inside(n, box), `${id} is inside group ${box.id}`);
          assert.ok(n.x - box.x >= GROUP_PAD && box.x + box.width - (n.x + NODE_W) >= GROUP_PAD, `${id} is padded`);
          assert.ok(n.y - box.y >= GROUP_PAD + GROUP_HEADER, `${id} is below the heading of ${box.id}`);
        } else {
          assert.ok(!overlaps(n, box), `${id} is outside group ${box.id}`);
        }
      }
    }
    l.groups.forEach((p, i) => l.groups.slice(i + 1).forEach((q) => {
      assert.ok(!(p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height), `groups ${p.id} and ${q.id} do not overlap`);
    }));
    for (const box of l.groups) assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= l.width && box.y + box.height <= l.height);
  }

  test('the sample: one box per group, in declaration order, around its nodes only', () => {
    const d = model(sampleManifest());
    const l = layoutArchitecture(d);
    assert.deepEqual(l.groups.map((g) => [g.id, g.label, g.first, g.last]), [['http', 'HTTP', 0, 0], ['domain', 'Domain', 1, 1], ['data', 'Data access', 2, 3], ['external', 'External', 2, 3]]);
    checkBoxes(d, l);
    assert.equal(l.crossings.after, 0);
  });

  test('generated graphs: members inside and padded, others outside, boxes never overlap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGraph(seed * 31, 5 + (seed % 16), 4 + (seed % 20), 1 + (seed % 5));
      checkBoxes(g, layoutArchitecture(g));
      checkBoxes(g, layoutArchitecture(g, { iterations: 0 }));
    }
  });

  test('a group spanning layers blocks every layer it spans, even one where it has no node', () => {
    const g = graph(['a', 'x', 'b', 'c'], [['a', 'x'], ['x', 'b'], ['a', 'b'], ['c', 'x']], { g: ['a', 'b'] });
    const l = layoutArchitecture(g);
    const [box] = l.groups;
    assert.deepEqual([box.first, box.last], [0, 2]);
    assert.ok(!overlaps(l.boxes.get('x'), box), 'x, on the layer in between, is beside the box');
    checkBoxes(g, l);
  });

  test('empty groups get no box; a wide group is as wide as its widest layer', () => {
    const g = graph(['r', 'w1', 'w2', 'w3'], [['r', 'w1'], ['r', 'w2'], ['r', 'w3']], { empty: [], wide: ['w1', 'w2', 'w3'] });
    const l = layoutArchitecture(g);
    assert.deepEqual(l.groups.map((x) => x.id), ['wide']);
    assert.equal(l.groups[0].width, 3 * NODE_W + 2 * 24 + 2 * GROUP_PAD);
    checkBoxes(g, l);
  });
});

describe('architecture layout: edges that skip layers', () => {
  test('an edge that would pass behind a node bends through a gap; one with a clear line stays straight', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['a', 'c']]);
    const l = layoutArchitecture(g);
    const bends = bendsAround(l.boxes.get('a'), l.boxes.get('c'), l);
    assert.equal(bends.length, 2, 'one pass through layer 1');
    const b = l.boxes.get('b');
    assert.ok(bends.every((p) => p.x <= b.x || p.x >= b.x + NODE_W), 'the pass is beside b, not through it');
    assert.deepEqual([bends[0].y, bends[1].y], [b.y, b.y + NODE_H]);
    assert.deepEqual(bendsAround(l.boxes.get('a'), l.boxes.get('b'), l), [], 'adjacent layers: straight');
    // A line that skips a layer through a gap is left straight.
    const clear = { rows: [[{ x: 0, y: 0 }], [{ x: 300, y: 100 }], [{ x: 0, y: 200 }]] };
    assert.deepEqual(bendsAround({ x: 0, y: 0, layer: 0 }, { x: 0, y: 200, layer: 2 }, clear), []);
    // Opposite edges are moved apart.
    const back = bendsAround(l.boxes.get('c'), l.boxes.get('a'), l, -5);
    assert.deepEqual(back.map((p) => p.x), [...bends].reverse().map((p) => p.x - 5));
  });

  test('the rendered path of a bent edge has its bends; direction and arrowhead are kept', () => {
    const m = viewManifest({ nodes: [['a'], ['b'], ['c']], edges: [['r1', 'a', 'b'], ['r2', 'b', 'c'], ['r3', 'a', 'c']] });
    const svg = svgOf(archHtml(render(m, { excerpts: [], stale: [] })));
    const lines = [...svg.matchAll(/<path class="line" d="([^"]+)"/g)].map((x) => x[1]);
    assert.equal(lines.length, 3);
    assert.equal(lines.filter((d) => (d.match(/L/g) ?? []).length === 3).length, 1, 'a → c goes start, two bends, arrow');
    assert.equal((svg.match(/<path class="head"/g) ?? []).length, 3);
    assert.match(svg, /<title>A → C: calls, proposed, no evidence<\/title>/);
  });
});

describe('render: architecture group boxes', () => {
  function mixed() {
    return viewManifest({
      groups: [{ id: 'top', label: 'Top' }, { id: 'empty', label: 'Nothing here' }, { id: 'bottom', label: 'Bottom' }],
      nodes: [['a', 'top'], ['b', 'top'], ['c'], ['d', 'bottom'], ['e', 'bottom'], ['f']],
      edges: [['r1', 'a', 'b'], ['r2', 'b', 'd'], ['r3', 'd', 'e'], ['r4', 'a', 'e'], ['r5', 'e', 'a'], ['r6', 'a', 'b'], ['r7', 'b', 'a'], ['r8', 'c', 'c'], ['r9', 'c', 'f']],
    });
  }

  test('boxes for groups with nodes, drawn first and hiding nothing; headings after edges, before nodes', () => {
    const m = mixed();
    assert.equal(validateManifest(m).valid, true);
    const part = archHtml(render(m, { excerpts: [], stale: [] }));
    const svg = svgOf(part);
    assert.equal((svg.match(/<g class="group">/g) ?? []).length, 2, 'the empty group has no box');
    assert.match(svg, /aria-label="View: 6 node\(s\) and 9 relationship\(s\), 2 group\(s\), listed in the text version below"/);
    const firstGroup = svg.indexOf('<g class="group">');
    const firstEdge = svg.indexOf('<g class="edge');
    const firstHeading = svg.indexOf('<text class="group-label"');
    const firstNode = svg.indexOf('<g class="node');
    assert.ok(firstGroup < firstEdge && firstEdge < firstHeading && firstHeading < firstNode);
    assert.equal((svg.match(/<g class="node plain">/g) ?? []).length, 6, 'no node dropped');
    assert.match(svg, /<title>Group Top: 2 node\(s\)\. Declared by this view to organize it; not a claim\.<\/title>/);
    assert.ok(!/<title>Group[^<]*source/.test(svg), 'groups cite no evidence');
  });

  test('parallel, opposite and self-loop edges keep their semantics; the text version lists every one', () => {
    const part = archHtml(render(mixed(), { excerpts: [], stale: [] }));
    const svg = svgOf(part);
    // a→b (r1, r6) share a line; b→a has its own; c→c is not drawn.
    assert.equal((svg.match(/<g class="edge declared">/g) ?? []).length, 7);
    assert.match(svg, /<title>A → B: calls, proposed, no evidence\nA → B: calls, proposed, no evidence<\/title>/);
    assert.ok(part.includes('C → C <span class="kind">calls</span>') && part.includes('(connects a node to itself; not drawn)'));
    const text = part.slice(part.indexOf('<div class="diagram-summary">'));
    assert.equal((text.match(/<li>[A-F] → [A-F] /g) ?? []).length, 9, 'every relationship is in the text version');
  });

  test('the text version lists every group in declaration order, empty ones and ungrouped nodes included', () => {
    const part = archHtml(render(mixed(), { excerpts: [], stale: [] }));
    const groups = part.slice(part.indexOf('<h4>Groups</h4>'));
    assert.match(groups, /not claims, no evidence, and not by themselves runtime, deployment or process boundaries/);
    const order = ['Top <span class="kind">group <code>top</code>', 'Nothing here <span class="kind">group <code>empty</code>', 'Bottom <span class="kind">group <code>bottom</code>'].map((s) => groups.indexOf(s));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2]);
    assert.ok(groups.includes('2 node(s): A, B.'));
    assert.ok(groups.includes('No node of this view is in this group, so no box is drawn.'));
    assert.ok(groups.includes('In no group (drawn without a box): C, F.'));
    assert.match(part, /Box with a heading: a group this view declares, to organize its nodes\. Not a claim and not backed by evidence; it does not by itself mean a runtime, deployment or process boundary\./);
  });

  test('a view without groups has no boxes, no group legend and no group list', () => {
    const part = archHtml(render(viewManifest({ nodes: [['a'], ['b']], edges: [['r', 'a', 'b']] }), { excerpts: [], stale: [] }));
    assert.ok(!part.includes('class="group') && !part.includes('Box with a heading') && !part.includes('<h4>Groups</h4>'));
    assert.match(part, /aria-label="View: 2 node\(s\) and 1 relationship\(s\), listed/);
  });

  test('the impact diagram never gets group boxes or the group legend', () => {
    const out = render(sampleManifest(), { excerpts: [], stale: [] });
    const impact = out.slice(out.indexOf('<h3>Impact diagram</h3>'), out.indexOf('<h3>Direct impact</h3>'));
    assert.ok(!impact.includes('class="group') && !impact.includes('Box with a heading') && !impact.includes('<h4>Groups</h4>'));
  });

  test('long group labels are cut to fit the box and complete elsewhere; long node lines are cut too', () => {
    const long = `${'W'.repeat(150)}`;
    const m = viewManifest({ groups: [{ id: 'g', label: long }], nodes: [['a', 'g']] });
    const part = archHtml(render(m, { excerpts: [], stale: [] }));
    const svg = svgOf(part);
    const heading = svg.match(/<text class="group-label"[^>]*>([^<]*)<\/text>/)[1];
    assert.ok(heading.endsWith('…'));
    assert.ok(Array.from(heading).length * 9 <= NODE_W + 2 * GROUP_PAD, 'fits the box at a generous 9px per character');
    assert.ok(svg.includes(`<title>Group ${long}: 1 node(s)`));
    assert.ok(part.includes(`${long} <span class="kind">group <code>g</code>`));
    const status = [...svg.matchAll(/<text class="status"[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
    assert.ok(status.every((s) => Array.from(s).length <= 26), 'status lines fit the node');
    assert.ok(svg.includes(`<title>A (module): module · ${long};`), 'the node title keeps the full group');
  });
});

describe('render: architecture evidence, stale state and safety', () => {
  test('stale evidence stays unverified inside a group, with no excerpt; groups add no evidence', () => {
    const m = sampleManifest();
    const stale = [{ evidenceId: 'ev-route', path: '/evidence/0', file: m.evidence.find((e) => e.id === 'ev-route').file, status: 'changed', action: 'reanalyze', claims: [], manualSections: [], manualOnly: false, message: 'changed' }];
    const part = archHtml(render(m, { excerpts: [], stale }), 'Payment components');
    const svg = svgOf(part);
    assert.match(svg, /<g class="node plain unverified">\n<title>POST \/orders\/:orderId\/pay \(endpoint\): endpoint · HTTP; observed · unverified<\/title>/);
    assert.match(svg, /<g class="edge declared unverified">/);
    assert.ok(!part.includes('<pre'), 'no excerpt');
    const current = svgOf(archHtml(render(sampleManifest(), { excerpts: [], stale: [] }), 'Payment components'));
    assert.equal((current.match(/<text class="status"[^>]*>[^<]*source\(s\)<\/text>/g) ?? []).length, 7, 'one evidence line per node; group boxes add none');
    assert.ok(!/<text class="group-label"[^>]*>[^<]*(source|verified|evidence)/.test(svg));
  });

  test('an unknown evidence id is still a render error, never a partial diagram', () => {
    const m = sampleManifest();
    m.analysis.components.find((c) => c.id === 'payment-repo').evidence = ['ev-ghost'];
    assert.throws(() => render(m, { excerpts: [], stale: [] }), (e) => e instanceof RenderError && /unknown evidence id "ev-ghost"/.test(e.message));
  });

  test('hostile group labels, group ids, node labels, edge labels, evidence files and long text are escaped', () => {
    const m = sampleManifest();
    const view = m.visualizations.architecture[0];
    for (const g of view.groups) g.label = `${g.id} ${PAYLOAD} ${'Z'.repeat(300)}`;
    // Group ids are schema ids; the hostile part goes where the schema allows free text.
    for (const c of m.analysis.components) c.name = `${c.id} ${PAYLOAD}${'x'.repeat(200)}`;
    for (const r of m.analysis.relationships) r.label = PAYLOAD;
    m.evidence.find((e) => e.id === 'ev-route').file = `src/${PAYLOAD}.js`;
    const out = render(m, { excerpts: [], stale: [] });
    assert.ok(!out.includes(PAYLOAD));
    const part = archHtml(out, 'Payment components');
    const svg = svgOf(part);
    assert.ok(svg.includes(escapeHtml(PAYLOAD)));
    assert.ok(!/<script|<img|<!--|<foreignObject|<a[\s>]|<use|<image/i.test(svg));
    for (const [whole] of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
      const tag = whole.replace(/"[^"]*"/g, '""');
      assert.ok(!/\son[a-z]+\s*=/i.test(tag), `event handler in ${tag}`);
      assert.ok(!/\s(id|href|xlink:href|src|style|xmlns)\s*=/i.test(tag), `no ids, links, inline styles or namespaces: ${tag}`);
    }
    assert.ok(!/url\(/.test(svg));
    assert.ok(!svg.includes('<code>'), 'group ids appear only in the text version');
    assert.ok(part.includes('group <code>http</code>'));
    assert.ok(part.includes(`<code>src/${escapeHtml(PAYLOAD)}.js:`), 'evidence file in the text version');
  });

  test('hostile group ids and labels in a hand-built model are escaped too', () => {
    const d = buildDiagram({
      id: 'd', title: 'D',
      nodes: [{ id: PAYLOAD, label: PAYLOAD, kind: 'module', impact: null, certainty: 'proposed', evidenceIds: [], group: PAYLOAD }],
      edges: [],
      groups: [{ id: PAYLOAD, label: PAYLOAD, nodeIds: [PAYLOAD] }],
    }, new Set());
    const out = String(diagram(d, { sources: () => '', isStale: () => false }, { empty: 'none' }));
    assert.ok(!out.includes(PAYLOAD));
    assert.ok(out.includes(`group <code>${escapeHtml(PAYLOAD)}</code>`));
    assert.ok(!/<script|<img|<!--/i.test(out));
  });

  test('scripts, CSP and the stylesheet are unchanged; output is deterministic byte for byte', () => {
    const out = render(sampleManifest(), { excerpts: [], stale: [] });
    assert.ok(!/<script/i.test(out));
    assert.ok(out.includes(`content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`));
    assert.equal((out.match(/<style>/g) ?? []).length, 1);
    assert.equal(out, render(sampleManifest(), { excerpts: [], stale: [] }));
    const big = viewManifest({ groups: [{ id: 'g', label: 'G' }, { id: 'h', label: 'H' }], nodes: Array.from({ length: 20 }, (_, i) => [`n${i}`, i % 3 === 0 ? 'g' : i % 3 === 1 ? 'h' : undefined]), edges: Array.from({ length: 30 }, (_, i) => [`r${i}`, `n${(i * 7) % 20}`, `n${(i * 11 + 3) % 20}`]).filter(([, a, b]) => a !== b) });
    assert.equal(render(big, { excerpts: [], stale: [] }), render(structuredClone(big), { excerpts: [], stale: [] }));
  });
});

describe('render: architecture narrow screens', () => {
  // Checked in headless Chrome at 1280px and a 390px viewport, light and
  // dark, with the sample and views with many groups, long labels,
  // disconnected components and a wide group: the page never scrolls
  // sideways, wide views scroll inside .diagram-scroll, group headings fit
  // their boxes, no node is cut by a box, and dark mode stays readable.
  test('each architecture view sits in its own scroll container and fits only up to FIT_WIDTH', () => {
    const m = viewManifest({ groups: [{ id: 'w', label: 'Wide' }], nodes: [['r'], ['a', 'w'], ['b', 'w'], ['c', 'w']], edges: [['r1', 'r', 'a'], ['r2', 'r', 'b'], ['r3', 'r', 'c']] });
    const svg = archHtml(render(m, { excerpts: [], stale: [] }));
    assert.match(svg, /<div class="diagram-scroll">\n<svg class="diagram wide" width="(\d+)"/);
    assert.ok(Number(svg.match(/width="(\d+)"/)[1]) > FIT_WIDTH);
    const one = archHtml(render(viewManifest({ groups: [{ id: 'g', label: 'G' }], nodes: [['a', 'g']] }), { excerpts: [], stale: [] }));
    assert.match(one, /<svg class="diagram fit" width="244"/);
    const out = render(sampleManifest(), { excerpts: [], stale: [] });
    assert.ok(/svg\.diagram \.group rect\{fill:none;/.test(out), 'group boxes have no fill, so they hide nothing');
  });
});
