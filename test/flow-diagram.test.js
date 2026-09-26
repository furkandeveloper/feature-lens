import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executionFlowDiagram, sequenceDiagram, stateMachineDiagram, dataFlowDiagram } from '../src/analysis/flow-models.js';
import { DiagramError } from '../src/analysis/diagram-model.js';
import { FLOW_FIT_WIDTH } from '../src/render/flow-diagram.js';
import { render, RenderError } from '../src/render/render.js';
import { escapeHtml } from '../src/render/escape.js';
import { validateManifest } from '../src/validation/validate.js';
import { sampleManifest } from './helpers.js';

const PAYLOAD = `<img src=x onerror="alert(1)">'&</text><script>alert(2)</script><!-- featurelens {} -->`;
const observed = (...evidence) => ({ certainty: 'observed', evidence });
const proposed = { certainty: 'proposed', evidence: [] };

// The sample's visualization of each type, by the key and id its sections use.
const TYPES = {
  executionFlows: { id: 'exec-pay-order', build: executionFlowDiagram, edges: 'links' },
  sequences: { id: 'seq-pay', build: sequenceDiagram, edges: 'messages' },
  stateMachines: { id: 'sm-order-status', build: stateMachineDiagram, edges: 'transitions' },
  dataFlows: { id: 'df-card-data', build: dataFlowDiagram, edges: 'flows' },
};

/** Small valid visualizations of each type; `claim` goes on every claim-carrying item. */
const small = {
  executionFlows: (claim = observed('ev-route')) => ({
    id: 'exec-pay-order', title: 'Flow T', start: 'a',
    steps: [
      { id: 'a', label: 'Step A', next: [{ to: 'b', condition: 'ok' }, { to: 'c', condition: 'fail' }], ...claim },
      { id: 'b', label: 'Step B', next: [{ to: 'a' }], ...claim },
      { id: 'c', label: 'Step C', ...claim },
    ],
  }),
  sequences: (claim = observed('ev-route')) => ({
    id: 'seq-pay', title: 'Sequence T',
    participants: [{ id: 'p', label: 'P' }, { id: 'q', label: 'Q' }],
    messages: [
      { from: 'p', to: 'q', label: 'zeta()', kind: 'call', ...claim },
      { from: 'q', to: 'p', label: 'alpha', kind: 'return', ...claim },
    ],
  }),
  stateMachines: (claim = observed('ev-route')) => ({
    id: 'sm-order-status', title: 'States T',
    states: [{ id: 'new', label: 'new', initial: true }, { id: 'done', label: 'done', terminal: true }],
    transitions: [{ from: 'new', to: 'done', trigger: 'finish', guard: 'valid', ...claim }],
  }),
  dataFlows: (claim = observed('ev-route')) => ({
    id: 'df-card-data', title: 'Data T',
    nodes: [{ id: 'in', label: 'Input', kind: 'source' }, { id: 'proc', label: 'Proc', kind: 'process' }, { id: 'db', label: 'DB', kind: 'store' }],
    flows: [{ from: 'in', to: 'proc', data: 'order', ...claim }, { from: 'proc', to: 'db', data: 'row', ...claim }],
  }),
};

function withViz(type, viz) {
  const m = sampleManifest();
  m.visualizations[type] = [viz];
  return m;
}

function staleEntry(manifest, evidenceId) {
  const i = manifest.evidence.findIndex((e) => e.id === evidenceId);
  return {
    evidenceId, path: `/evidence/${i}`, file: manifest.evidence[i].file, status: 'changed', action: 'reanalyze',
    claims: [], manualSections: [], manualOnly: false, message: 'changed',
  };
}

/** The figure whose caption starts with `title`. */
function figure(out, title) {
  const start = out.lastIndexOf('<figure class="viz">', out.indexOf(`<figcaption>${title} `));
  assert.ok(start >= 0 && out.includes(`<figcaption>${title} `), `figure ${title}`);
  return out.slice(start, out.indexOf('</figure>', start));
}

const svgOf = (text) => text.slice(text.indexOf('<svg'), text.indexOf('</svg>') + 6);
const count = (text, re) => (text.match(re) ?? []).length;
const renderOk = (m, stale = []) => render(m, { excerpts: [], stale });
const freeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v)); return Object.freeze(o); };

describe('Phase 3B diagrams: evidence rules for every type', () => {
  for (const [type, { build, edges }] of Object.entries(TYPES)) {
    const title = small[type]().title;

    test(`${type}: current evidence is counted, never called verified`, () => {
      const fig = figure(renderOk(withViz(type, small[type]())), title);
      assert.ok(svgOf(fig).includes('1 source(s)'));
      assert.ok(!svgOf(fig).includes('unverified'), 'nothing is marked unverified');
      assert.ok(!/\bverified\b/.test(fig.replace(/unverified/g, '')), 'never says verified');
      assert.ok(fig.includes('href="#evidence-ev-route"'), 'text version links the evidence');
    });

    test(`${type}: stale evidence is marked unverified in the SVG and the text version, with no code`, () => {
      const m = withViz(type, small[type]());
      const fig = figure(renderOk(m, [staleEntry(m, 'ev-route')]), title);
      const svg = svgOf(fig);
      assert.ok(/>[^<]*unverified[^<]*<\/(tspan|text)>/.test(svg), 'the SVG says it in visible text');
      assert.ok(/class="(edge declared|message \w+) unverified/.test(svg), 'and marks the edge');
      assert.ok(fig.includes('<span class="badge unverified">unverified</span>'), 'text version links carry the badge');
      assert.ok(!fig.includes('<pre'), 'no excerpt');
      assert.ok(!svg.includes('1 source(s)'));
    });

    test(`${type}: unknown evidence ids are refused, in the model and by the renderer`, () => {
      const m = withViz(type, small[type](observed('ev-ghost')));
      assert.throws(() => build(m, m.visualizations[type][0]), (e) => e instanceof DiagramError && /unknown evidence id "ev-ghost"/.test(e.message));
      assert.throws(() => renderOk(m), (e) => e instanceof RenderError && /unknown evidence id "ev-ghost"/.test(e.message));
    });

    test(`${type}: evidence-free claims are allowed for proposed and unknown, and say so`, () => {
      const m = withViz(type, small[type](proposed));
      const model = build(m, m.visualizations[type][0]);
      assert.ok(model[edges].every((e) => e.certainty === 'proposed' && e.evidenceIds.length === 0));
      const fig = figure(renderOk(m), title);
      assert.ok(svgOf(fig).includes('no evidence'));
      assert.ok(fig.includes('No evidence cited.'));
      const unknown = withViz(type, small[type]({ certainty: 'unknown', evidence: [] }));
      assert.doesNotThrow(() => build(unknown, unknown.visualizations[type][0]));
      const inferred = withViz(type, small[type]({ certainty: 'inferred', evidence: [] }));
      assert.throws(() => build(inferred, inferred.visualizations[type][0]), /certainty "inferred" requires evidence/);
    });

    test(`${type}: declared relationships keep their own claim; nothing is derived`, () => {
      const m = withViz(type, small[type](observed('ev-route', 'ev-pay-order')));
      const model = build(m, m.visualizations[type][0]);
      for (const e of model[edges]) {
        assert.deepEqual([e.certainty, e.evidenceIds], ['observed', ['ev-route', 'ev-pay-order']]);
        assert.equal(e.basis, undefined);
        assert.equal(e.via, undefined);
      }
      const fig = figure(renderOk(m), title);
      assert.ok(fig.includes('<span class="badge declared">declared</span>'));
      assert.ok(!/derived/.test(fig), 'no derived items, badges or legend');
      // The stale rule doesn't reclassify anything either.
      const stale = figure(renderOk(m, [staleEntry(m, 'ev-route')]), title);
      assert.ok(!/derived/.test(stale));
    });

    test(`${type}: incomplete input is refused with a clear error`, () => {
      const m = sampleManifest();
      const v = small[type]();
      assert.throws(() => build(m, { ...v, id: '' }), /diagram id/);
      assert.throws(() => build(m, { ...v, title: '' }), /title must be a non-empty string/);
      const key = Object.keys(v).find((k) => Array.isArray(v[k]) && k !== TYPES[type].edges);
      assert.throws(() => build(m, { ...v, [key]: undefined }), new RegExp(`${key} must be an array`));
      const bad = structuredClone(v);
      bad[key][0].label = '';
      assert.throws(() => build(m, bad), /label must be a non-empty string/);
      const noEvidence = structuredClone(v);
      const edgeList = noEvidence[TYPES[type].edges] ?? noEvidence.steps;
      delete edgeList[0].evidence;
      assert.throws(() => build(m, noEvidence), /evidence must be an array/);
    });

    test(`${type}: a repeated node id is dropped when identical and refused when it differs`, () => {
      const m = sampleManifest();
      const v = small[type]();
      const key = Object.keys(v).find((k) => Array.isArray(v[k]) && k !== TYPES[type].edges);
      const same = structuredClone(v);
      same[key].push(structuredClone(same[key][0]));
      const model = build(m, same);
      const nodes = model.steps ?? model.participants ?? model.states ?? model.nodes;
      assert.equal(nodes.length, v[key].length);
      const different = structuredClone(v);
      different[key].push({ ...structuredClone(different[key][0]), label: 'other' });
      assert.throws(() => build(m, different), /appears twice with different content/);
    });

    test(`${type}: deterministic, manifest order, and the manifest is not modified`, () => {
      const m = withViz(type, small[type]());
      const before = structuredClone(m);
      freeze(m);
      const a = build(m, m.visualizations[type][0]);
      assert.deepEqual(build(m, m.visualizations[type][0]), a);
      assert.deepEqual(m, before);
      a[edges][0].evidenceIds.push('x');
      assert.deepEqual(build(m, m.visualizations[type][0]), build(before, before.visualizations[type][0]), 'no shared arrays');
      assert.equal(renderOk(before), renderOk(structuredClone(before)));
    });
  }
});

describe('Phase 3B diagrams: empty input', () => {
  test('models accept empty lists and the renderer says there is nothing to draw', () => {
    const m = sampleManifest();
    assert.deepEqual(executionFlowDiagram(m, { id: 'e', title: 'E', steps: [] }), { type: 'executionFlow', id: 'e', title: 'E', start: null, steps: [], links: [] });
    assert.deepEqual(sequenceDiagram(m, { id: 's', title: 'S', participants: [], messages: [] }).messages, []);
    assert.equal(stateMachineDiagram(m, { id: 'm', title: 'M', states: [], transitions: [] }).initial, null);
    assert.deepEqual(dataFlowDiagram(m, { id: 'd', title: 'D', nodes: [], flows: [] }).flows, []);

    for (const [type, v, text] of [
      ['executionFlows', { id: 'exec-pay-order', title: 'Empty flow', steps: [] }, 'This flow has no steps.'],
      ['sequences', { id: 'seq-pay', title: 'Empty seq', participants: [], messages: [] }, 'This sequence has no participants.'],
      ['stateMachines', { id: 'sm-order-status', title: 'Empty sm', states: [], transitions: [] }, 'This state machine has no states.'],
      ['dataFlows', { id: 'df-card-data', title: 'Empty df', nodes: [], flows: [] }, 'This data flow has no nodes.'],
    ]) {
      const fig = figure(renderOk(withViz(type, v)), v.title);
      assert.ok(fig.includes(`<p class="empty">${text}</p>`), type);
      assert.ok(!fig.includes('<svg'), type);
    }
  });

  test('an empty flow cannot name a start step, and a sequence without messages still shows its participants', () => {
    assert.throws(() => executionFlowDiagram(sampleManifest(), { id: 'e', title: 'E', start: 'x', steps: [] }), /start "x" is not a step/);
    const fig = figure(renderOk(withViz('sequences', { ...small.sequences(), messages: [] })), 'Sequence T');
    assert.equal(count(svgOf(fig), /<g class="participant">/g), 2);
    assert.ok(fig.includes('No messages were recorded.'));
  });

  test('single-node diagrams', () => {
    const one = { id: 'exec-pay-order', title: 'One', start: 'a', steps: [{ id: 'a', label: 'Only', ...proposed }] };
    const svg = svgOf(figure(renderOk(withViz('executionFlows', one)), 'One'));
    assert.equal(count(svg, /<rect /g), 1);
    assert.ok(!svg.includes('class="edge'));
    assert.ok(svg.includes('>start · no next step<'));
  });
});

describe('execution flows', () => {
  test('links come from next entries, carry their step\'s claim, and keep conditions', () => {
    const m = sampleManifest();
    const d = executionFlowDiagram(m, m.visualizations.executionFlows[0]);
    assert.equal(d.start, 's-load');
    assert.deepEqual(d.steps.filter((s) => s.decision).map((s) => s.id), ['s-found', 's-pending', 's-succeeded']);
    assert.deepEqual(d.steps.filter((s) => s.end).map((s) => s.id), ['s-not-found', 's-not-payable', 's-declined', 's-mark-paid']);
    assert.deepEqual(d.links[1], {
      id: 'next:s-found/1', source: 's-found', target: 's-pending', condition: 'yes', claimOf: 's-found', certainty: 'observed', evidenceIds: ['ev-order-guards'],
    });
    assert.deepEqual(d.steps[0].component, { id: 'order-repo', name: 'OrderRepository' });
    assert.equal(d.steps[0].evidenceIds.length, 1, 'the component\'s evidence is not borrowed');
  });

  test('the start step goes on the first layer even when listed last; steps are not re-sorted', () => {
    const v = small.executionFlows();
    v.steps.reverse();
    const d = executionFlowDiagram(sampleManifest(), v);
    assert.deepEqual(d.steps.map((s) => s.id), ['c', 'b', 'a']);
    const svg = svgOf(figure(renderOk(withViz('executionFlows', v)), 'Flow T'));
    const y = (label) => Number(svg.match(new RegExp(`<text class="label" x="[\\d.]+" y="([\\d.]+)" text-anchor="middle"><tspan [^>]*>${label}<`))[1]);
    assert.ok(y('Step A') < y('Step B') && y('Step A') < y('Step C'));
    const fig = figure(renderOk(withViz('executionFlows', v)), 'Flow T');
    assert.ok(fig.includes('Steps are listed in manifest order; the order of execution is given only by the start step and the links.'));
  });

  test('branches are explicit; a branch without a condition says so', () => {
    const v = small.executionFlows(proposed);
    delete v.steps[0].next[1].condition;
    const fig = figure(renderOk(withViz('executionFlows', v)), 'Flow T');
    const svg = svgOf(fig);
    assert.equal(count(svg, /<g class="node step start decision">/g), 1);
    assert.ok(svg.includes('<path class="shape"'), 'decision shape');
    assert.ok(svg.includes('>start · decision · 2 ways<'));
    assert.ok(svg.includes('>ok</tspan>'), 'the condition is on the arrow');
    assert.equal(count(fig, /No condition is given for this branch\./g), 1);
  });

  test('cycles and self-loops terminate and are drawn', () => {
    const v = small.executionFlows(proposed);
    v.steps[2].next = [{ to: 'c' }, { to: 'a' }];
    const m = withViz('executionFlows', v);
    const svg = svgOf(figure(renderOk(m), 'Flow T'));
    assert.equal(count(svg, /<g class="edge declared loop">/g), 1);
    assert.ok(figure(renderOk(m), 'Flow T').includes('(links a step to itself)'));
    assert.equal(renderOk(m), renderOk(structuredClone(m)));
  });

  test('refuses links and starts that are not steps, and unknown components', () => {
    const m = sampleManifest();
    assert.throws(() => executionFlowDiagram(m, { ...small.executionFlows(), start: 'zz' }), /start "zz" is not a step/);
    const v = small.executionFlows();
    v.steps[1].next = [{ to: 'ghost' }];
    assert.throws(() => executionFlowDiagram(m, v), /next step "ghost" is not a step/);
    const w = small.executionFlows();
    w.steps[0].componentId = 'nope';
    assert.throws(() => executionFlowDiagram(m, w), /unknown component "nope"/);
  });
});

describe('sequences', () => {
  test('messages keep manifest order (never sorted by label), sender and receiver', () => {
    const d = sequenceDiagram(sampleManifest(), small.sequences());
    assert.deepEqual(d.messages.map((x) => [x.id, x.index, x.source, x.target, x.label]), [
      ['message:1', 1, 'p', 'q', 'zeta()'],
      ['message:2', 2, 'q', 'p', 'alpha'],
    ]);
    const svg = svgOf(figure(renderOk(withViz('sequences', small.sequences())), 'Sequence T'));
    assert.ok(svg.indexOf('zeta()') < svg.indexOf('alpha'));
    const ys = [...svg.matchAll(/<g class="message [^"]*">\n<title>[^<]*<\/title>\n<path class="line" d="M[\d.]+ ([\d.]+)/g)].map((x) => Number(x[1]));
    assert.ok(ys[0] < ys[1], 'top to bottom in message order');
    assert.ok(svg.includes('<path class="head open"'), 'returns have an open head');
  });

  test('self-messages and repeated messages are kept', () => {
    const v = small.sequences(proposed);
    v.messages.push({ from: 'p', to: 'p', label: 'retry()', kind: 'async', ...proposed }, { ...v.messages[0] });
    const d = sequenceDiagram(sampleManifest(), v);
    assert.deepEqual(d.messages.map((x) => x.self), [false, false, true, false]);
    assert.equal(d.messages[3].label, d.messages[0].label);
    assert.equal(d.messages[3].id, 'message:4');
    const fig = figure(renderOk(withViz('sequences', v)), 'Sequence T');
    assert.equal(count(svgOf(fig), /<g class="message /g), 4);
    assert.ok(fig.includes('(to itself)'));
    assert.equal(count(fig.slice(fig.indexOf('<ol>')), /<li>/g), 4);
  });

  test('a message to a missing participant is refused', () => {
    const v = small.sequences();
    v.messages[1].to = 'nobody';
    assert.throws(() => sequenceDiagram(sampleManifest(), v), (e) => e instanceof DiagramError && /message 2: to "nobody" is not a participant/.test(e.message));
    const w = small.sequences();
    w.messages[0].kind = 'rpc';
    assert.throws(() => sequenceDiagram(sampleManifest(), w), /kind must be/);
  });

  test('long labels wrap to the space between lifelines; the full label is in the title and text version', () => {
    const v = small.sequences(proposed);
    const long = 'processEverythingInTheWholeSystem(firstArgument, secondArgument, thirdArgument)';
    v.messages[0].label = long;
    const fig = figure(renderOk(withViz('sequences', v)), 'Sequence T');
    const svg = svgOf(fig);
    const tspans = [...svg.matchAll(/<text class="edge-label"[^>]*>(.*?)<\/text>/g)][0][1].match(/<tspan [^>]*>([^<]*)<\/tspan>/g);
    assert.ok(tspans.length <= 2);
    assert.ok(tspans.every((t) => Array.from(t.replace(/<[^>]+>/g, '')).length <= 22));
    assert.ok(svg.includes(`${long} (call)`), 'title keeps it whole');
    assert.ok(fig.slice(fig.indexOf('diagram-summary')).includes(long));
  });
});

describe('state machines', () => {
  test('initial and terminal states are only what is declared', () => {
    const m = sampleManifest();
    const d = stateMachineDiagram(m, m.visualizations.stateMachines[0]);
    assert.equal(d.initial, 'pending');
    assert.deepEqual(d.terminals, []);
    const fig = figure(renderOk(m), 'Order status during payment');
    assert.ok(fig.includes('No terminal state is declared.'));
    assert.ok(fig.includes('nothing here says which states are reachable'));
    assert.ok(!fig.includes('Double border'), 'legend only explains what is drawn');

    const none = small.stateMachines();
    delete none.states[0].initial;
    const n = stateMachineDiagram(m, none);
    assert.equal(n.initial, null, 'never inferred from order or transitions');
    assert.ok(n.states.every((s) => !s.initial));
    const noInitial = figure(renderOk(withViz('stateMachines', none)), 'States T');
    assert.ok(noInitial.includes('No initial state is declared.'));
    assert.ok(!noInitial.includes('Thick border') && !noInitial.includes('class="node state initial'), 'nothing is drawn as initial');
    assert.throws(() => stateMachineDiagram(m, { ...none, states: [{ id: 'x', label: 'x', initial: true }, { id: 'y', label: 'y', initial: true }], transitions: [] }), /declares 2 initial states/);
    assert.throws(() => stateMachineDiagram(m, { ...small.stateMachines(), transitions: [{ from: 'done', to: 'new', trigger: 'again', ...proposed }] }), /leaves terminal state "done"/);
  });

  test('self-loops are drawn as loops and counted on the state', () => {
    const svg = svgOf(figure(renderOk(sampleManifest()), 'Order status during payment'));
    assert.equal(count(svg, /<g class="edge declared loop">/g), 1);
    assert.ok(svg.includes('>1 self-transition(s)<'));
    assert.ok(svg.includes('<g class="node state initial">'));
  });

  test('duplicate and parallel transitions: all kept in order, repeats marked, one line with a count', () => {
    const v = small.stateMachines(proposed);
    v.transitions.push({ ...v.transitions[0] }, { from: 'new', to: 'done', trigger: 'cancel', ...proposed });
    const d = stateMachineDiagram(sampleManifest(), v);
    assert.deepEqual(d.transitions.map((t) => [t.id, t.repeats]), [['transition:1', undefined], ['transition:2', 1], ['transition:3', undefined]]);
    const fig = figure(renderOk(withViz('stateMachines', v)), 'States T');
    const svg = svgOf(fig);
    assert.equal(count(svg, /<g class="edge declared">/g), 1);
    const label = [...svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((x) => x[1]).join(' ');
    assert.ok(label.includes('finish [valid] (+2 more)'), label);
    assert.equal(count(svg.slice(svg.indexOf('<g class="edge')), /\n\d\. new → done on /g), 2, 'the line title lists every transition');
    assert.ok(fig.includes('(same ends, trigger and guard as transition 1)'));
    assert.equal(renderOk(withViz('stateMachines', v)), renderOk(withViz('stateMachines', structuredClone(v))));
  });

  test('terminal states get a second border and a word, not only a style', () => {
    const svg = svgOf(figure(renderOk(withViz('stateMachines', small.stateMachines())), 'States T'));
    assert.ok(svg.includes('<g class="node state terminal">'));
    assert.ok(svg.includes('<rect class="inner"'));
    assert.ok(svg.includes('>terminal state<'));
  });
});

describe('data flows', () => {
  test('nodes keep their declared kind; only stores are described as holding data', () => {
    const m = sampleManifest();
    const d = dataFlowDiagram(m, m.visualizations.dataFlows[0]);
    assert.deepEqual(d.nodes.map((n) => n.kind), ['source', 'process', 'external', 'store', 'store']);
    const fig = figure(renderOk(m), 'Where payment data goes');
    assert.equal(count(fig, /holds data/g), 2);
    assert.equal(count(svgOf(fig), /<path class="mark"/g), 2, 'store marker');
    assert.ok(svgOf(fig).includes('>processing<') && svgOf(fig).includes('>external system<'));
  });

  test('direction is preserved; opposite flows are drawn side by side with their labels apart', () => {
    const m = sampleManifest();
    const d = dataFlowDiagram(m, m.visualizations.dataFlows[0]);
    assert.deepEqual(d.flows.slice(1, 3).map((f) => [f.source, f.target]), [['service', 'gateway'], ['gateway', 'service']]);
    const svg = svgOf(figure(renderOk(m), 'Where payment data goes'));
    assert.ok(svg.includes('text-anchor="start"') && svg.includes('text-anchor="end"'));
  });

  test('repeated data labels, cycles and self-loops', () => {
    const v = small.dataFlows(proposed);
    v.flows.push({ from: 'db', to: 'proc', data: 'row', ...proposed }, { from: 'proc', to: 'proc', data: 'row', ...proposed });
    const d = dataFlowDiagram(sampleManifest(), v);
    assert.deepEqual(d.flows.map((f) => [f.id, f.data, f.self]), [['flow:1', 'order', false], ['flow:2', 'row', false], ['flow:3', 'row', false], ['flow:4', 'row', true]]);
    const fig = figure(renderOk(withViz('dataFlows', v)), 'Data T');
    assert.equal(count(svgOf(fig), /<g class="edge declared loop">/g), 1);
    assert.ok(fig.includes('(back to the same node)'));
    assert.ok(svgOf(fig).includes('>1 flow(s) to itself<'));
  });

  test('refuses unknown node kinds and flows between unknown nodes', () => {
    const v = small.dataFlows();
    v.nodes[0].kind = 'database';
    assert.throws(() => dataFlowDiagram(sampleManifest(), v), /kind must be/);
    const w = small.dataFlows();
    w.flows[0].to = 'ghost';
    assert.throws(() => dataFlowDiagram(sampleManifest(), w), /flow 1: to "ghost" is not a node/);
  });
});

describe('Phase 3B diagrams: escaping and safety', () => {
  function hostile() {
    const m = sampleManifest();
    const v = m.visualizations;
    v.executionFlows[0].title = PAYLOAD;
    v.executionFlows[0].steps.forEach((s) => { s.label = PAYLOAD; (s.next ?? []).forEach((n) => { n.condition = PAYLOAD; }); });
    v.sequences[0].participants.forEach((p) => { p.label = PAYLOAD; });
    v.sequences[0].messages.forEach((x) => { x.label = PAYLOAD; });
    v.stateMachines[0].subject = PAYLOAD;
    v.stateMachines[0].states.forEach((s) => { s.label = PAYLOAD; });
    v.stateMachines[0].transitions.forEach((t) => { t.trigger = PAYLOAD; t.guard = PAYLOAD; });
    v.dataFlows[0].nodes.forEach((n) => { n.label = PAYLOAD; });
    v.dataFlows[0].flows.forEach((f) => { f.data = PAYLOAD; });
    return m;
  }

  test('every label, condition, trigger, guard, subject and data value is escaped; the SVG has only safe elements', () => {
    const m = hostile();
    const out = renderOk(m, [staleEntry(m, 'ev-route')]);
    assert.ok(!out.includes(PAYLOAD));
    assert.ok(!/<script/i.test(out));
    const figs = ['executionFlows', 'sequences', 'stateMachines', 'dataFlows'].map((t) => m.visualizations[t][0]);
    for (const viz of figs) {
      const start = out.indexOf(`<figcaption>${escapeHtml(viz.title)} `);
      assert.ok(start >= 0, viz.id);
      const fig = out.slice(start, out.indexOf('</figure>', start));
      const svg = svgOf(fig);
      assert.ok(svg.includes(escapeHtml(PAYLOAD)), viz.id);
      assert.ok(!/<script|<img|<!--|<foreignObject|<a[\s>]|<use|<image|<style/i.test(svg));
      for (const [whole] of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
        const tag = whole.replace(/"[^"]*"/g, '""');
        assert.ok(/^<(svg|title|g|rect|path|text|tspan)[\s>]/.test(tag), `only safe SVG elements: ${tag}`);
        assert.ok(!/\son[a-z]+\s*=/i.test(tag), `event handler in ${tag}`);
        assert.ok(!/\s(id|href|xlink:href|src|style|xmlns)\s*=/i.test(tag), `no ids, links, inline styles or namespaces: ${tag}`);
      }
      assert.ok(!/url\(/.test(svg));
    }
  });

  test('the CSP, the single stylesheet and the absence of scripts are unchanged', () => {
    const out = renderOk(hostile());
    assert.equal(count(out, /<meta http-equiv="Content-Security-Policy"/g), 1);
    assert.ok(out.includes(`content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`));
    assert.equal(count(out, /<style>/g), 1);
    assert.ok(!/<script/i.test(out));
  });
});

describe('Phase 3B diagrams: sections, layout and the pipeline', () => {
  test('a manual section shows the diagrams it lists, and nothing generated beyond them', () => {
    const m = sampleManifest();
    const notes = m.documentation.sections.find((s) => s.id === 'team-notes');
    notes.visualizations = ['seq-pay', 'sm-order-status'];
    const out = renderOk(m);
    const start = out.indexOf('<section id="section-team-notes"');
    const s = out.slice(start, out.indexOf('</section>', start));
    assert.equal(count(s, /<svg class="diagram /g), 2);
    assert.ok(s.includes('<span class="badge manual">manual</span>'));
    assert.ok(!s.includes('<h3>Components</h3>') && !s.includes('Impact diagram'));
  });

  test('every diagram scrolls in its own container; only narrow Phase 3B diagrams scale down', () => {
    const out = renderOk(sampleManifest());
    assert.equal(count(out, /<svg /g), count(out, /<div class="diagram-scroll">\n<svg /g));
    const flows = [...out.matchAll(/<span class="kind">(Execution flow|Sequence|State machine|Data flow)<\/span><\/figcaption>[\s\S]*?<svg class="diagram (?:sequence )?(fit|wide)" width="(\d+)"/g)];
    assert.equal(flows.length, 4);
    for (const [, , cls, w] of flows) assert.equal(cls, Number(w) <= FLOW_FIT_WIDTH ? 'fit' : 'wide');
    const style = out.slice(out.indexOf('<style>'), out.indexOf('</style>'));
    assert.match(style, /\.diagram-scroll\{overflow-x:auto;max-width:100%\}/);
    assert.match(style, /svg\.diagram\.fit\{max-width:100%\}/);
  });

  test('titles and accessible descriptions name the counts and point to the text version', () => {
    const out = renderOk(sampleManifest());
    assert.ok(out.includes('aria-label="payOrder control flow: 10 step(s) and 9 link(s), listed in the text version below"'));
    assert.ok(out.includes('aria-label="Successful payment: 6 participant(s) and 8 message(s) in order, listed in the text version below"'));
    assert.ok(out.includes('aria-label="Order status during payment: 2 state(s) and 2 transition(s), listed in the text version below"'));
    assert.ok(out.includes('aria-label="Where payment data goes: 5 node(s) and 5 flow(s), listed in the text version below"'));
  });

  test('no schema change: the sample is still valid and renders the same bytes twice', () => {
    assert.equal(validateManifest(sampleManifest()).valid, true);
    for (const [type, make] of Object.entries(small)) assert.equal(validateManifest(withViz(type, make())).valid, true, type);
    const m = sampleManifest();
    assert.equal(renderOk(m, [staleEntry(m, 'ev-route')]), renderOk(sampleManifest(), [staleEntry(m, 'ev-route')]));
  });
});
