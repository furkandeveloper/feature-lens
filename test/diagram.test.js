import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { impactDiagram, architectureDiagram, buildDiagram, DiagramError } from '../src/analysis/diagram-model.js';
import { layoutDiagram, wrapLabel, FIT_WIDTH } from '../src/render/diagram.js';
import { FLOW_FIT_WIDTH } from '../src/render/flow-diagram.js';
import { render, RenderError } from '../src/render/render.js';
import { escapeHtml } from '../src/render/escape.js';
import { validateManifest } from '../src/validation/validate.js';
import { sampleManifest, minimalManifest } from './helpers.js';

const PAYLOAD = `<img src=x onerror="alert(1)">'&</text><script>alert(2)</script><!-- featurelens {} -->`;
const claim = { certainty: 'proposed', evidence: [] };
const component = (id, extra = {}) => ({ id, name: id.toUpperCase(), kind: 'module', summary: id, ...claim, ...extra });

/** A small valid graph: cli → api → svc; svc impacted; `new.js` added and declared to affect svc. */
function graphManifest() {
  const m = minimalManifest();
  m.analysis.components = [component('api'), component('svc'), component('cli'), component('lone')];
  m.analysis.relationships = [
    { id: 'r1', from: 'api', to: 'svc', kind: 'calls', ...claim },
    { id: 'r2', from: 'cli', to: 'api', kind: 'calls', ...claim },
  ];
  m.analysis.impact.items = [
    { id: 'i-svc', componentId: 'svc', level: 'high', change: 'modify', reason: 'svc changes', ...claim },
    { id: 'i-new', file: 'src/new.js', level: 'low', change: 'add', reason: 'new file', ...claim },
  ];
  m.analysis.impact.relationships = [{ id: 'ir', from: 'i-new', to: 'i-svc', reason: 'svc must call new', ...claim }];
  m.documentation.sections.push({ id: 'impact', title: 'Impact', kind: 'impact', origin: 'generated', provenance: { historyId: 'h-1' } });
  m.history[0].changedSections.push('impact');
  return m;
}

function staleEntry(manifest, evidenceId) {
  const i = manifest.evidence.findIndex((e) => e.id === evidenceId);
  return {
    evidenceId, path: `/evidence/${i}`, file: manifest.evidence[i].file, status: 'changed', action: 'reanalyze',
    claims: [], manualSections: [], manualOnly: false, message: 'changed',
  };
}

function sectionHtml(out, id) {
  const start = out.indexOf(`<section id="section-${id}"`);
  assert.notEqual(start, -1, `section ${id} rendered`);
  return out.slice(start, out.indexOf('</section>', start));
}

/** The impact diagram part of an impact section: from its heading to the direct impact list. */
function impactDiagramHtml(out, section = 'impact') {
  const s = sectionHtml(out, section);
  return s.slice(s.indexOf('<h3>Impact diagram</h3>'), s.indexOf('<h3>Direct impact</h3>'));
}

const svgOf = (text) => text.slice(text.indexOf('<svg'), text.indexOf('</svg>') + 6);
const EVIDENCE = (ids) => new Set(ids);
const node = (id, extra = {}) => ({ id, label: id, kind: 'module', impact: null, certainty: 'proposed', evidenceIds: [], ...extra });
const edge = (id, source, target, extra = {}) => ({ id, source, target, kind: 'calls', basis: 'declared', certainty: 'proposed', evidenceIds: [], ...extra });

describe('diagram model: impact', () => {
  test('the sample: direct nodes from impact items, declared edges from impact relationships, nothing derived', () => {
    const m = sampleManifest();
    const d = impactDiagram(m);
    assert.equal(d.id, 'impact');
    assert.deepEqual(d.nodes.map((n) => [n.id, n.impact]), [
      ['pay-route', 'direct'], ['payment-service', 'direct'], ['payment-repo', 'direct'], ['file:src/payment/idempotency.store.js', 'direct'],
    ]);
    const service = d.nodes.find((n) => n.id === 'payment-service');
    assert.deepEqual(service, {
      id: 'payment-service', label: 'PaymentService', kind: 'service', impact: 'direct', level: 'high', changes: ['review'],
      certainty: 'observed', evidenceIds: ['ev-pay-order'],
    });
    assert.deepEqual(d.edges.map((e) => [e.id, e.source, e.target, e.basis]), [
      ['ir-service-repo', 'payment-service', 'payment-repo', 'declared'],
      ['ir-service-route', 'payment-service', 'pay-route', 'declared'],
      ['ir-idempotency-service', 'file:src/payment/idempotency.store.js', 'payment-service', 'declared'],
    ]);
    // pay-route depends on payment-service but is directly impacted itself: it stays direct.
    assert.equal(d.nodes.find((n) => n.id === 'pay-route').impact, 'direct');
  });

  test('derived impact is labelled derived and carries no certainty or evidence', () => {
    const d = impactDiagram(graphManifest());
    assert.deepEqual(d.nodes.map((n) => [n.id, n.impact]), [['api', 'derived'], ['svc', 'direct'], ['cli', 'derived'], ['file:src/new.js', 'direct']]);
    for (const n of d.nodes.filter((x) => x.impact === 'derived')) {
      assert.equal(n.certainty, null);
      assert.deepEqual(n.evidenceIds, []);
      assert.equal(n.level, undefined);
    }
    const derived = d.edges.filter((e) => e.basis === 'derived');
    assert.deepEqual(derived.map((e) => [e.source, e.target, e.via]), [['svc', 'api', ['r1']], ['api', 'cli', ['r2']]]);
    for (const e of derived) {
      assert.equal(e.certainty, null);
      assert.deepEqual(e.evidenceIds, []);
      assert.equal(e.kind, 'derived-impact');
    }
    assert.ok(!d.nodes.some((n) => n.id === 'lone'), 'unaffected components are not drawn');
  });

  test('derived edges follow the dependency direction, including reversed kinds', () => {
    const m = graphManifest();
    m.analysis.components.push(component('settings', { kind: 'config' }));
    m.analysis.relationships.push({ id: 'r3', from: 'settings', to: 'svc', kind: 'configures', ...claim });
    m.analysis.impact.items[0].componentId = 'settings';
    const d = impactDiagram(m);
    assert.deepEqual(d.edges.filter((e) => e.basis === 'derived').map((e) => [e.source, e.target]),
      [['svc', 'api'], ['api', 'cli'], ['settings', 'svc']]);
  });

  test('two relationships between the same pair give one derived edge naming both', () => {
    const m = graphManifest();
    m.analysis.relationships.push({ id: 'r1b', from: 'api', to: 'svc', kind: 'imports', ...claim });
    const derived = impactDiagram(m).edges.filter((e) => e.basis === 'derived');
    assert.deepEqual(derived.map((e) => [e.id, e.via]), [
      ['derived:["svc","api"]', ['r1', 'r1b']],
      ['derived:["api","cli"]', ['r2']],
    ]);
  });

  test('a node named by several items takes the strongest level, every change, and the weakest certainty', () => {
    const m = sampleManifest();
    m.analysis.impact.items.push({ id: 'imp-service-2', componentId: 'payment-service', level: 'low', change: 'modify', reason: 'x', certainty: 'inferred', evidence: ['ev-charge-call', 'ev-pay-order'] });
    const n = impactDiagram(m).nodes.find((x) => x.id === 'payment-service');
    assert.equal(n.level, 'high');
    assert.deepEqual(n.changes, ['review', 'modify']);
    assert.equal(n.certainty, 'inferred', 'never claims more than its weakest item');
    assert.deepEqual(n.evidenceIds, ['ev-pay-order', 'ev-charge-call']);
  });

  test('evidence-free declared relationships are allowed for proposed and unknown claims', () => {
    const d = impactDiagram(graphManifest());
    const ir = d.edges.find((e) => e.id === 'ir');
    assert.deepEqual([ir.basis, ir.certainty, ir.evidenceIds], ['declared', 'proposed', []]);
  });

  test('no impact items: an empty diagram', () => {
    const d = impactDiagram(minimalManifest());
    assert.deepEqual([d.nodes, d.edges], [[], []]);
  });

  test('is deterministic, follows manifest order, and does not modify the manifest', () => {
    const m = graphManifest();
    const before = structuredClone(m);
    const freeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v)); return Object.freeze(o); };
    freeze(m);
    const a = impactDiagram(m);
    assert.deepEqual(impactDiagram(m), a);
    assert.deepEqual(m, before);
    a.nodes[0].evidenceIds.push('x');
    assert.deepEqual(impactDiagram(m), impactDiagram(before), 'the model shares no arrays with the manifest');

    const r = graphManifest();
    r.analysis.components.reverse();
    assert.deepEqual(impactDiagram(r).nodes.map((n) => n.id), ['cli', 'svc', 'api', 'file:src/new.js']);
  });

  test('a manifest whose impact data does not hold together is refused', () => {
    const m = graphManifest();
    m.analysis.impact.items[0].evidence = ['ev-nope'];
    m.analysis.impact.items[0].certainty = 'observed';
    assert.throws(() => impactDiagram(m), (e) => e instanceof DiagramError && /unknown evidence id "ev-nope"/.test(e.message));

    const m2 = graphManifest();
    m2.analysis.impact.relationships[0].to = 'i-missing';
    assert.throws(() => impactDiagram(m2), /target "undefined" is not a node/);

    const m3 = graphManifest();
    m3.analysis.impact.relationships[0].certainty = 'observed';
    assert.throws(() => impactDiagram(m3), /certainty "observed" requires evidence/);
  });
});

describe('diagram model: architecture views', () => {
  test('nodes are the view\'s components, edges its relationships, with group labels', () => {
    const m = sampleManifest();
    const d = architectureDiagram(m, m.visualizations.architecture[0]);
    assert.equal(d.title, 'Payment components');
    assert.deepEqual(d.nodes.map((n) => [n.id, n.group]).slice(0, 2), [['pay-route', 'HTTP'], ['payment-service', 'Domain']]);
    assert.ok(d.nodes.every((n) => n.impact === null));
    assert.deepEqual(d.edges.map((e) => e.id), m.visualizations.architecture[0].edges);
    const e = d.edges.find((x) => x.id === 'r-route-service');
    assert.deepEqual(e, { id: 'r-route-service', source: 'pay-route', target: 'payment-service', kind: 'calls', basis: 'declared', certainty: 'observed', evidenceIds: ['ev-route'], label: 'payOrder(orderId, cardToken)' });
  });

  test('refuses views naming what the manifest lacks', () => {
    const m = sampleManifest();
    const view = structuredClone(m.visualizations.architecture[0]);
    assert.throws(() => architectureDiagram(m, { ...view, edges: ['r-nope'] }), /unknown relationship "r-nope"/);
    assert.throws(() => architectureDiagram(m, { ...view, nodes: [{ componentId: 'c-nope' }] }), /unknown component "c-nope"/);
    assert.throws(() => architectureDiagram(m, { ...view, nodes: [{ componentId: 'pay-route', group: 'g-nope' }], edges: [] }), /unknown group "g-nope"/);
    assert.throws(() => architectureDiagram(m, { ...view, nodes: [{ componentId: 'pay-route' }] }), /target "payment-service" is not a node/);
  });
});

describe('diagram model: buildDiagram contract', () => {
  const ok = (nodes, edges = [], evidence = []) => buildDiagram({ id: 'd', title: 'D', nodes, edges }, EVIDENCE(evidence));
  const bad = (re, nodes, edges = [], evidence = []) => assert.throws(() => ok(nodes, edges, evidence), (e) => e instanceof DiagramError && re.test(e.message));

  test('stable ids and input order are kept', () => {
    const d = ok([node('b'), node('a')], [edge('e2', 'a', 'b'), edge('e1', 'b', 'a')]);
    assert.deepEqual(d.nodes.map((n) => n.id), ['b', 'a']);
    assert.deepEqual(d.edges.map((e) => e.id), ['e2', 'e1']);
  });

  test('an identical duplicate is dropped; a conflicting one is refused', () => {
    const d = ok([node('a'), node('b'), { ...node('a') }], [edge('e', 'a', 'b'), { evidenceIds: [], ...edge('e', 'a', 'b') }]);
    assert.deepEqual(d.nodes.map((n) => n.id), ['a', 'b']);
    assert.equal(d.edges.length, 1);
    bad(/node "a" appears twice with different content/, [node('a'), node('a', { label: 'other' })]);
    bad(/edge "e" appears twice with different content/, [node('a'), node('b')], [edge('e', 'a', 'b'), edge('e', 'b', 'a')]);
  });

  test('evidence must be known; observed and inferred need some', () => {
    assert.deepEqual(ok([node('a', { certainty: 'observed', evidenceIds: ['ev'] })], [], ['ev']).nodes[0].evidenceIds, ['ev']);
    bad(/unknown evidence id "ev-x"/, [node('a', { evidenceIds: ['ev-x'] })], [], ['ev']);
    bad(/unknown evidence id "ev-x"/, [node('a'), node('b')], [edge('e', 'a', 'b', { evidenceIds: ['ev-x'] })]);
    bad(/certainty "inferred" requires evidence/, [node('a', { certainty: 'inferred' })]);
    bad(/unknown certainty "sure"/, [node('a', { certainty: 'sure' })]);
  });

  test('derived items cannot carry certainty or evidence, and direct impact cannot become derived silently', () => {
    const derivedNode = node('d', { impact: 'derived', certainty: null });
    ok([derivedNode, node('a')], [edge('x', 'a', 'd', { basis: 'derived', certainty: null, via: ['r'] })]);
    bad(/derived impact is not a claim/, [node('d', { impact: 'derived' })]);
    bad(/derived impact cannot cite evidence/, [{ ...derivedNode, evidenceIds: ['ev'] }], [], ['ev']);
    bad(/derived impact cannot cite evidence/, [derivedNode, node('a')], [edge('x', 'a', 'd', { basis: 'derived', certainty: null, evidenceIds: ['ev'], via: ['r'] })], ['ev']);
    bad(/must name the relationships it follows/, [derivedNode, node('a')], [edge('x', 'a', 'd', { basis: 'derived', certainty: null })]);
    bad(/only derived edges follow relationships/, [node('a'), node('b')], [edge('x', 'a', 'b', { via: ['r'] })]);
    bad(/direct impact needs a level/, [node('a', { impact: 'direct' })]);
    bad(/level and changes belong to direct impact only/, [{ ...derivedNode, level: 'high' }]);
    bad(/impact must be/, [node('a', { impact: 'indirect' })]);
    bad(/basis must be/, [node('a'), node('b')], [edge('x', 'a', 'b', { basis: 'inferred' })]);
  });

  test('incomplete input fails clearly', () => {
    assert.throws(() => buildDiagram({ title: 'x', nodes: [], edges: [] }, EVIDENCE([])), /diagram id/);
    assert.throws(() => buildDiagram({ id: 'd', title: '', nodes: [], edges: [] }, EVIDENCE([])), /title/);
    assert.throws(() => buildDiagram({ id: 'd', title: 'D', nodes: [] }, EVIDENCE([])), /arrays/);
    bad(/node id/, [node('')]);
    bad(/label must be a string/, [node('a', { label: 3 })]);
    bad(/source "zz" is not a node/, [node('a')], [edge('e', 'zz', 'a')]);
  });
});

describe('diagram layout', () => {
  const model = (nodes, edges = []) => buildDiagram({ id: 'd', title: 'D', nodes: nodes.map((id) => node(id)), edges: edges.map(([s, t], i) => edge(`e${i}`, s, t)) }, EVIDENCE([]));

  test('empty and single-node diagrams', () => {
    assert.deepEqual(layoutDiagram(model([])), { width: 0, height: 0, boxes: new Map() });
    const one = layoutDiagram(model(['a']));
    assert.deepEqual([one.width, one.height, one.boxes.get('a')], [224, 96, { x: 12, y: 12, layer: 0 }]);
  });

  test('each node sits one layer below the deepest node pointing at it; layers keep node order', () => {
    const l = layoutDiagram(model(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['a', 'c'], ['a', 'd']]));
    assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => l.boxes.get(id).layer), [0, 1, 2, 1]);
    assert.ok(l.boxes.get('b').x < l.boxes.get('d').x);
  });

  test('cycles and self-loops terminate deterministically', () => {
    const m = model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a'], ['b', 'b']]);
    const l = layoutDiagram(m);
    assert.deepEqual(['a', 'b', 'c'].map((id) => l.boxes.get(id).layer), [0, 1, 2]);
    assert.deepEqual(layoutDiagram(m), l);
  });

  test('long labels wrap to at most two lines of at most 24 characters', () => {
    assert.deepEqual(wrapLabel('PaymentService'), ['PaymentService']);
    assert.deepEqual(wrapLabel(''), ['']);
    const long = wrapLabel('Card gateway charges API with an extraordinarily long label');
    assert.equal(long.length, 2);
    assert.ok(long.every((l) => Array.from(l).length <= 24));
    assert.ok(long[1].endsWith('…'));
    const token = wrapLabel('src/payment/a-very-long-directory-name/idempotency.store.js');
    assert.ok(token.every((l) => Array.from(l).length <= 24), 'unbroken tokens are split');
    assert.deepEqual(wrapLabel('😀'.repeat(60)).map((l) => Array.from(l).length), [24, 24], 'code points are never split');
  });
});

describe('render: impact diagram', () => {
  test('a generated impact section shows the diagram before the lists, with direct and derived told apart', () => {
    const out = render(graphManifest(), { excerpts: [], stale: [] });
    const part = impactDiagramHtml(out);
    const svg = svgOf(part);
    assert.match(svg, /^<svg class="diagram fit" width="\d+" height="\d+" viewBox="0 0 \d+ \d+" role="img" aria-label="Impact diagram: 4 node\(s\) and 3 relationship\(s\), listed in the text version below">\n<title>Impact diagram<\/title>/);
    assert.equal((svg.match(/<g class="node direct">/g) ?? []).length, 2);
    assert.equal((svg.match(/<g class="node derived">/g) ?? []).length, 2);
    assert.equal((svg.match(/<g class="edge declared">/g) ?? []).length, 1);
    assert.equal((svg.match(/<g class="edge derived">/g) ?? []).length, 2);
    assert.equal((svg.match(/<path class="head"/g) ?? []).length, 3, 'every edge shows its direction');
    // Not by color alone: the text says it.
    assert.equal((svg.match(/>derived impact</g) ?? []).length, 2);
    assert.equal((svg.match(/>not a claim · no evidence</g) ?? []).length, 2);
    assert.match(svg, /<title>SVC → API: derived impact, not a claim, no evidence<\/title>/);
    assert.ok(part.indexOf('<svg') < part.indexOf('class="diagram-legend"') && part.indexOf('class="diagram-legend"') < part.indexOf('class="diagram-summary"'));
    assert.match(part, /Dashed border: derived impact\. Not a claim and not backed by evidence/);
  });

  test('the text version lists every node and relationship', () => {
    const part = impactDiagramHtml(render(graphManifest(), { excerpts: [], stale: [] }));
    const text = part.slice(part.indexOf('class="diagram-summary"'));
    assert.ok(text.includes('Text version: 4 node(s), 3 relationship(s).'));
    for (const label of ['API', 'SVC', 'CLI', 'src/new.js']) assert.ok(text.includes(label), label);
    assert.ok(text.includes('<span class="badge derived">derived</span> API'));
    assert.ok(text.includes('<span class="badge direct">direct</span> SVC'));
    assert.ok(text.includes('src/new.js → SVC <span class="kind">impact</span> <span class="badge declared">declared</span>'));
    assert.ok(text.includes('follows relationship(s) <code>r1</code>'));
  });

  test('current and stale evidence: stale shows as unverified in the diagram and the text version, never with code', () => {
    const m = sampleManifest();
    const current = impactDiagramHtml(render(m, { excerpts: [], stale: [] }));
    assert.ok(!svgOf(current).includes('unverified') && !current.includes('badge unverified'));
    assert.match(svgOf(current), />observed · 1 source\(s\)</);
    assert.ok(!/\bverified\b/.test(current), 'the diagram never calls evidence verified');

    const stale = impactDiagramHtml(render(m, { excerpts: [], stale: [staleEntry(m, 'ev-route')] }));
    const svg = svgOf(stale);
    assert.match(svg, /<g class="node direct unverified">\n<title>POST \/orders\/:orderId\/pay \(endpoint\): direct impact · low; observed · unverified<\/title>/);
    assert.match(svg, /<g class="edge declared unverified">/, 'ir-service-route cites ev-route');
    assert.ok(stale.includes('<span class="badge unverified">unverified</span>'), 'text version links carry the unverified badge');
    assert.ok(!stale.includes('<pre'), 'no excerpt in the diagram');
    assert.equal((svg.match(/<g class="node direct/g) ?? []).length, 4, 'stale evidence does not turn direct impact into derived');
  });

  test('an unknown evidence id in the impact data is a render error, not a partial diagram', () => {
    const m = graphManifest();
    m.analysis.impact.relationships[0].evidence = ['ev-ghost'];
    assert.throws(() => render(m, { excerpts: [], stale: [] }), (e) => e instanceof RenderError && /unknown evidence id "ev-ghost"/.test(e.message));
  });

  test('empty, one node, multiple nodes and edges', () => {
    const empty = minimalManifest();
    empty.documentation.sections[0].kind = 'impact';
    const e = impactDiagramHtml(render(empty, { excerpts: [], stale: [] }), 'overview');
    assert.ok(e.includes('<p class="empty">Nothing to draw: no impact items were recorded.</p>'));
    assert.ok(!e.includes('<svg'));

    const one = graphManifest();
    one.analysis.impact.items = [one.analysis.impact.items[1]];
    one.analysis.impact.relationships = [];
    const svg = svgOf(impactDiagramHtml(render(one, { excerpts: [], stale: [] })));
    assert.equal((svg.match(/<rect /g) ?? []).length, 1);
    assert.ok(!svg.includes('class="edge'));

    const many = svgOf(impactDiagramHtml(render(sampleManifest(), { excerpts: [], stale: [] })));
    assert.equal((many.match(/<rect /g) ?? []).length, 4);
    assert.equal((many.match(/<g class="edge /g) ?? []).length, 3);
  });

  test('long labels are wrapped in the SVG and complete in its titles and the text version', () => {
    const m = graphManifest();
    const long = 'A component with a remarkably long and descriptive name that cannot fit';
    m.analysis.components[1].name = long;
    const part = impactDiagramHtml(render(m, { excerpts: [], stale: [] }));
    const svg = svgOf(part);
    const tspans = [...svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((x) => x[1]);
    assert.ok(tspans.every((t) => Array.from(t).length <= 24));
    assert.ok(tspans.some((t) => t.endsWith('…')));
    assert.ok(svg.includes(`<title>${long} (module)`));
    assert.ok(part.slice(part.indexOf('diagram-summary')).includes(long));
  });

  test('an impact section written by a person never shows the diagram', () => {
    const m = graphManifest();
    Object.assign(m.documentation.sections.find((s) => s.id === 'impact'), { origin: 'manual', body: 'Our notes.' });
    const s = sectionHtml(render(m, { excerpts: [], stale: [] }), 'impact');
    assert.ok(!s.includes('Impact diagram') && !s.includes('<svg'));
  });

  test('parallel and self-loop edges: one line per pair and basis; self-loops listed but not drawn', () => {
    const m = graphManifest();
    m.analysis.impact.relationships.push({ id: 'ir2', from: 'i-new', to: 'i-svc', reason: 'second reason', ...claim });
    m.analysis.impact.items.push({ id: 'i-svc-2', componentId: 'svc', level: 'low', change: 'review', reason: 'again', ...claim });
    m.analysis.impact.relationships.push({ id: 'ir-self', from: 'i-svc', to: 'i-svc-2', reason: 'same node', ...claim });
    const part = impactDiagramHtml(render(m, { excerpts: [], stale: [] }));
    const svg = svgOf(part);
    assert.equal((svg.match(/<g class="edge declared">/g) ?? []).length, 1);
    assert.match(svg, /<title>src\/new\.js → SVC: impact, proposed, no evidence\. svc must call new\nsrc\/new\.js → SVC: impact, proposed, no evidence\. second reason<\/title>/);
    assert.ok(part.includes('SVC → SVC <span class="kind">impact</span>') && part.includes('(connects a node to itself; not drawn)'));
  });
});

describe('render: architecture view diagrams', () => {
  test('architecture visualizations are drawn; every other type is drawn too, with no placeholder left', () => {
    const out = render(sampleManifest(), { excerpts: [], stale: [] });
    const arch = sectionHtml(out, 'architecture');
    const svg = svgOf(arch.slice(arch.indexOf('<figure class="viz">')));
    assert.match(svg, /aria-label="Payment components: 7 node\(s\) and 6 relationship\(s\)/);
    assert.equal((svg.match(/<g class="node plain">/g) ?? []).length, 7);
    assert.equal((svg.match(/<g class="edge declared">/g) ?? []).length, 6);
    assert.ok(svg.includes('>endpoint · HTTP<'));
    assert.ok(!svg.includes('derived'));
    assert.ok(!out.includes('Diagram rendering is not available'));
    const flows = sectionHtml(out, 'flows');
    assert.equal((flows.match(/<svg class="diagram /g) ?? []).length, 3, 'sequence, state machine and data flow');
  });

  test('a manual section shows the visualizations it references, as the existing contract allows', () => {
    const m = sampleManifest();
    m.documentation.sections.find((s) => s.id === 'team-notes').visualizations = ['arch-payment'];
    const s = sectionHtml(render(m, { excerpts: [], stale: [] }), 'team-notes');
    assert.ok(s.includes('<svg class="diagram'));
    assert.ok(!s.includes('Impact diagram'));
  });
});

describe('render: diagram escaping and safety', () => {
  function hostile() {
    const m = sampleManifest();
    for (const c of m.analysis.components) c.name = `${c.id} ${PAYLOAD}`;
    m.analysis.impact.items[3].file = `src/${PAYLOAD.replace(/[\s<>"'&!{}]/g, '_')}.js`;
    for (const r of m.analysis.impact.relationships) r.reason = PAYLOAD;
    for (const r of m.analysis.relationships) r.label = PAYLOAD;
    m.visualizations.architecture[0].title = PAYLOAD;
    m.visualizations.architecture[0].groups[0].label = PAYLOAD;
    for (const type of ['executionFlows', 'sequences', 'stateMachines', 'dataFlows']) m.visualizations[type][0].title = PAYLOAD;
    m.evidence.find((e) => e.id === 'ev-route').file = `src/${PAYLOAD}.js`;
    return m;
  }

  test('titles, node labels, edge labels, group labels and evidence values are escaped', () => {
    const m = hostile();
    const out = render(m, { excerpts: [], stale: [staleEntry(m, 'ev-route')] });
    assert.ok(!out.includes(PAYLOAD));
    const svgs = [...out.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((x) => x[0]);
    assert.equal(svgs.length, 6, 'impact, architecture and the four Phase 3B diagrams');
    for (const svg of svgs) {
      assert.ok(svg.includes(escapeHtml(PAYLOAD)));
      assert.ok(!/<script|<img|<\/text><script|<!--|<foreignObject|<a[\s>]|<use|<image/i.test(svg));
      for (const [whole] of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
        // Attribute values are quoted and escaped, so only what is outside the quotes can be an attribute.
        const tag = whole.replace(/"[^"]*"/g, '""');
        assert.ok(!/\son[a-z]+\s*=/i.test(tag), `event handler in ${tag}`);
        assert.ok(!/\s(id|href|xlink:href|src|style|xmlns)\s*=/i.test(tag), `no ids, links, inline styles or namespaces: ${tag}`);
      }
      assert.ok(!/url\(/.test(svg));
    }
    assert.ok(out.includes(`aria-label="${escapeHtml(PAYLOAD)}: 7 node(s)`));
    assert.ok(out.includes(`<code>src/${escapeHtml(PAYLOAD)}.js:`), 'evidence file in the text version');
  });

  test('the document stays script-free with the same CSP and a single stylesheet', () => {
    const out = render(hostile(), { excerpts: [], stale: [] });
    assert.ok(!/<script/i.test(out));
    assert.equal((out.match(/<meta http-equiv="Content-Security-Policy"/g) ?? []).length, 1);
    assert.ok(out.includes(`content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`));
    assert.equal((out.match(/<style>/g) ?? []).length, 1);
    assert.ok(!/(?:https?|wss?):\/\//.test(out.replace(/<code>[^<]*<\/code>/g, '')), 'no URLs outside escaped text');
  });
});

describe('render: diagram narrow screens', () => {
  // Checked in headless Chrome at a 390px viewport with the sample: the page
  // stays 390px wide, the 712px architecture view scrolls inside its
  // .diagram-scroll container, and the 448px impact diagram scales to fit.
  const out = render(sampleManifest(), { excerpts: [], stale: [] });
  const style = out.slice(out.indexOf('<style>') + 7, out.indexOf('</style>'));
  const rule = (selector) => {
    const m = style.match(new RegExp(`(?:^|[}\\n])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`));
    assert.ok(m, `rule for ${selector}`);
    return m[1];
  };

  test('every diagram is inside its own scroll container', () => {
    assert.equal((out.match(/<svg /g) ?? []).length, (out.match(/<div class="diagram-scroll">\n<svg /g) ?? []).length);
    assert.match(rule('.diagram-scroll'), /overflow-x:auto/);
    assert.match(rule('.diagram-scroll'), /max-width:100%/);
  });

  test('narrow diagrams scale down to fit; wide ones keep their size and scroll', () => {
    assert.match(rule('svg.diagram.fit'), /max-width:100%/);
    assert.match(rule('svg.diagram.wide'), /max-width:none/);
    assert.match(rule('svg.diagram'), /height:auto/);
    // Impact and architecture diagrams fit up to FIT_WIDTH (unchanged); the Phase 3B types up to FLOW_FIT_WIDTH.
    const found = [...out.matchAll(/(?:<span class="kind">([^<]+)<\/span><\/figcaption>|<h3>Impact diagram<\/h3>)[\s\S]*?<svg class="diagram (?:sequence )?(fit|wide)" width="(\d+)"/g)];
    assert.equal(found.length, (out.match(/<svg /g) ?? []).length);
    for (const [, type = 'Impact', cls, w] of found) {
      const limit = ['Impact', 'Architecture view'].includes(type) ? FIT_WIDTH : FLOW_FIT_WIDTH;
      assert.equal(cls, Number(w) <= limit ? 'fit' : 'wide', `${type} ${w}`);
    }
    assert.ok(out.includes('<svg class="diagram wide"') && out.includes('<svg class="diagram fit"'), 'the sample has both');
  });

  test('history table and excerpt scrolling are unchanged', () => {
    assert.match(rule('.table-scroll'), /overflow-x:auto/);
    assert.match(rule('pre.excerpt'), /overflow-x:auto/);
  });
});

describe('diagrams and the rest of the pipeline', () => {
  test('diagrams need no schema change: the sample and minimal manifests are still valid', () => {
    assert.equal(validateManifest(sampleManifest()).valid, true);
    assert.equal(validateManifest(minimalManifest()).valid, true);
    assert.equal(validateManifest(graphManifest()).valid, true);
  });

  test('rendering is deterministic with diagrams', () => {
    const m = sampleManifest();
    const stale = [staleEntry(m, 'ev-route')];
    assert.equal(render(m, { excerpts: [], stale }), render(sampleManifest(), { excerpts: [], stale: [...stale] }));
  });
});
