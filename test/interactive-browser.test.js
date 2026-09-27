// Phase 3D in a real browser: the interactive impact graph under its real
// CSP in headless Chrome, at 1280px and 390px, light and dark. Each test is
// reported as skipped when no Chrome or Chromium is found, and fails instead
// with FEATURELENS_REQUIRE_BROWSER=1 (test/chrome.js).

import { describe, test as nodeTest, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render/render.js';
import { impactDiagram } from '../src/analysis/diagram-model.js';
import { IMPACT_SCRIPT_HASH } from '../src/render/interactive.js';
import { sampleManifest, derivedImpactManifest, staleEntry } from './helpers.js';
import { findChrome, launch, browserSkip } from './chrome.js';

const chrome = findChrome();
const skip = browserSkip(chrome);
/** Every test carries the skip itself, so a run without Chrome counts each one as skipped. */
const test = (name, fn) => nodeTest(name, { skip }, chrome ? fn : () => launch(chrome));

const m = derivedImpactManifest();
const inputs = { excerpts: [], stale: [staleEntry(m, 'ev-route')] };
const page = render(m, inputs, { interactive: true });
const model = impactDiagram(m);
const ref = (id) => `n${model.nodes.findIndex((n) => n.id === id)}`;
/** The impact diagram is on the impact section's page, which the URL hash opens. */
const AT_IMPACT = { hash: 'section-impact' };

/** What selecting `r` must highlight, from the model alone. */
function expected(r) {
  const drawn = model.edges.filter((e) => e.source !== e.target).map((e) => [ref(e.source), ref(e.target)]);
  const pairs = (list) => [...new Set(list.map(([s, t]) => `${s} ${t}`))].sort();
  return {
    incoming: pairs(drawn.filter(([, t]) => t === r)),
    outgoing: pairs(drawn.filter(([s]) => s === r)),
    neighbors: [...new Set(drawn.flatMap(([s, t]) => (t === r ? [s] : s === r ? [t] : [])))].filter((x) => x !== r).sort(),
    listedIn: model.edges.filter((e) => ref(e.target) === r).length,
    listedOut: model.edges.filter((e) => ref(e.source) === r).length,
  };
}

/** The graph's state as the page shows it. */
const STATE = `(() => {
  const root = document.querySelector('div.impact-graph');
  const nodes = [...root.querySelectorAll('g.node')];
  const edges = [...root.querySelectorAll('g.edge')];
  const pair = (g) => g.getAttribute('data-source') + ' ' + g.getAttribute('data-target');
  const style = (e) => getComputedStyle(e);
  const panel = root.querySelector('.impact-details');
  return {
    hasSelection: root.classList.contains('has-selection'),
    selected: nodes.filter((g) => g.classList.contains('is-selected')).map((g) => g.dataset.node),
    pressed: nodes.filter((g) => g.getAttribute('aria-pressed') === 'true').map((g) => g.dataset.node),
    neighbors: nodes.filter((g) => g.classList.contains('is-neighbor')).map((g) => g.dataset.node).sort(),
    incoming: [...new Set(edges.filter((g) => g.classList.contains('is-incoming')).map(pair))].sort(),
    outgoing: [...new Set(edges.filter((g) => g.classList.contains('is-outgoing')).map(pair))].sort(),
    opacity: Object.fromEntries(nodes.map((g) => [g.dataset.node, style(g).opacity])),
    edgeOpacity: Object.fromEntries(edges.map((g) => [pair(g), style(g).opacity])),
    stroke: Object.fromEntries(nodes.map((g) => [g.dataset.node, style(g.querySelector('rect')).strokeWidth])),
    weight: Object.fromEntries(nodes.map((g) => [g.dataset.node, style(g.querySelector('text.label')).fontWeight])),
    panelHidden: panel.hidden,
    panelText: panel.textContent,
    panelHeadings: [...panel.querySelectorAll('h4')].map((h) => h.textContent),
    panelRefs: panel.querySelectorAll('[data-node],[data-source],[data-target]').length,
    status: root.querySelector('.impact-status').textContent,
    resetDisabled: root.querySelector('button.impact-reset').disabled,
    active: document.activeElement?.dataset?.node ?? document.activeElement?.className ?? null,
  };
})()`;

describe('interactive impact graph in Chrome', () => {
  let b;
  before(async () => {
    if (chrome) b = await launch(chrome);
  });
  after(async () => {
    await b?.close();
  });

  async function state() {
    return b.eval(STATE);
  }

  function assertSelected(s, r) {
    const want = expected(r);
    assert.equal(s.hasSelection, true);
    assert.deepEqual(s.selected, [r]);
    assert.deepEqual(s.pressed, [r], 'aria-pressed');
    assert.deepEqual(s.incoming, want.incoming, 'incoming edges');
    assert.deepEqual(s.outgoing, want.outgoing, 'outgoing edges');
    assert.deepEqual(s.neighbors, want.neighbors, 'neighbors');
    assert.ok(s.panelHeadings.includes(`Incoming relationships (${want.listedIn})`), s.panelHeadings.join('|'));
    assert.ok(s.panelHeadings.includes(`Outgoing relationships (${want.listedOut})`), s.panelHeadings.join('|'));
    assert.equal(s.panelHidden, false);
    assert.equal(s.panelRefs, 0, 'copies carry no references');
    assert.equal(s.resetDisabled, false);
    assert.match(s.status, new RegExp(`${want.listedIn} incoming and ${want.listedOut} outgoing`));
    // Not color alone: width, weight and dimming.
    for (const [node, opacity] of Object.entries(s.opacity)) {
      assert.equal(opacity, node === r || want.neighbors.includes(node) ? '1' : '0.3', `opacity of ${node}`);
      if (node !== r) assert.notEqual(s.stroke[node], s.stroke[r]);
    }
    for (const [p, opacity] of Object.entries(s.edgeOpacity)) {
      assert.equal(opacity, want.incoming.includes(p) || want.outgoing.includes(p) ? '1' : '0.3', `opacity of edge ${p}`);
    }
    assert.equal(s.stroke[r], '4.5px');
    assert.equal(s.weight[r], '700');
  }

  function assertCleared(s) {
    assert.equal(s.hasSelection, false);
    assert.deepEqual(s.selected, []);
    assert.deepEqual(s.pressed, []);
    assert.deepEqual([s.incoming, s.outgoing, s.neighbors], [[], [], []]);
    assert.equal(s.panelHidden, true);
    assert.equal(s.resetDisabled, true);
    assert.ok(Object.values(s.opacity).every((o) => o === '1'));
  }

  test('the script runs under the CSP and enhances every node; the static content is all still there', async () => {
    await b.open(page, AT_IMPACT);
    assert.deepEqual(await b.eval('window.__cspViolations'), []);
    const nodes = await b.eval(`[...document.querySelectorAll('div.impact-graph g.node')].map((g) => ({ tabindex: g.getAttribute('tabindex'), role: g.getAttribute('role'), pressed: g.getAttribute('aria-pressed'), label: g.getAttribute('aria-label'), title: g.querySelector('title').textContent }))`);
    assert.equal(nodes.length, model.nodes.length);
    for (const n of nodes) {
      assert.deepEqual([n.tabindex, n.role, n.pressed], ['0', 'button', 'false']);
      assert.ok(n.label.length > 0);
      assert.equal(n.label, n.title);
    }
    const summary = await b.eval(`(() => { const s = document.querySelector('div.impact-graph .diagram-summary'); return { items: s.querySelectorAll('li').length, height: s.offsetHeight }; })()`);
    assert.equal(summary.items, model.nodes.length + model.edges.length, 'the text version is complete');
    assert.ok(summary.height > 0, 'and visible');
    const s = await state();
    assertCleared(s);
    assert.equal(s.status, '', 'nothing announced before a selection');
    assert.equal(await b.eval(`document.querySelectorAll('svg.diagram:not(div.impact-graph svg) [tabindex]').length`), 0, 'other diagrams stay static');
  });

  test('clicking a node highlights exactly its direct relationships and shows its details; clicking again clears', async () => {
    await b.open(page, AT_IMPACT);
    const service = ref('payment-service');
    await b.click(`g.node[data-node="${service}"]`);
    const s = await state();
    assertSelected(s, service);
    assert.match(s.panelText, /PaymentService/);
    assert.match(s.panelText, /declared/);

    const client = ref('client-1');
    await b.click(`g.node[data-node="${client}"]`);
    const d = await state();
    assertSelected(d, client);
    assert.match(d.panelText, /derived/);
    assert.match(d.panelText, /Not a claim and not backed by evidence/);
    assert.ok(expected(client).listedIn > 0 && expected(client).listedOut > 0, 'the fixture has derived edges both ways');

    await b.click(`g.node[data-node="${client}"]`);
    assertCleared(await state());
  });

  test('stale evidence is shown as unverified in the details', async () => {
    await b.open(page, AT_IMPACT);
    const route = ref('pay-route');
    await b.click(`g.node[data-node="${route}"]`);
    const s = await state();
    assertSelected(s, route);
    assert.match(s.panelText, /unverified/);
  });

  test('keyboard: Tab moves between nodes with a visible focus outline; Enter and Space select; Escape clears', async () => {
    await b.open(page, AT_IMPACT);
    await b.eval(`document.querySelector('div.impact-graph g.node[data-node="n0"]').focus()`);
    assert.equal((await state()).active, 'n0', 'nodes are focusable');
    await b.key('Tab');
    assert.equal((await state()).active, 'n1', 'Tab reaches the next node');
    const outline = await b.eval(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; })()`);
    assert.equal(outline, 'solid 3px');

    await b.key('Enter');
    assertSelected(await state(), 'n1');
    await b.key(' ');
    assertCleared(await state());
    await b.key(' ');
    assertSelected(await state(), 'n1');
    await b.key('Escape');
    const s = await state();
    assertCleared(s);
    assert.equal(s.active, 'n1', 'focus stays on the node');
    assert.equal(s.status, 'Selection cleared.');
  });

  test('the reset button clears the selection and returns focus to the node', async () => {
    await b.open(page, AT_IMPACT);
    await b.click('g.node[data-node="n2"]');
    assertSelected(await state(), 'n2');
    await b.click('button.impact-reset');
    const s = await state();
    assertCleared(s);
    assert.equal(s.active, 'n2');
  });

  test('when the script is blocked, the page is the static document: no dead controls, nothing focusable in the diagram', async () => {
    const blocked = page.replace(IMPACT_SCRIPT_HASH.replaceAll("'", '&#39;'), '&#39;sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=&#39;');
    assert.notEqual(blocked, page);
    await b.open(blocked, AT_IMPACT);
    const violations = await b.eval('window.__cspViolations');
    assert.ok(violations.some((v) => v.startsWith('script-src')), violations.join());
    const s = await b.eval(`({
      focusable: document.querySelectorAll('div.impact-graph [tabindex], div.impact-graph [role=button]').length,
      controls: document.querySelectorAll('.impact-toolbar, .impact-details, .impact-status, button').length,
      svg: document.querySelectorAll('div.impact-graph svg.diagram g.node').length,
      text: document.querySelectorAll('div.impact-graph .diagram-summary li').length,
      legend: document.querySelectorAll('div.impact-graph .diagram-legend li').length,
    })`);
    assert.deepEqual(s, { focusable: 0, controls: 0, svg: model.nodes.length, text: model.nodes.length + model.edges.length, legend: 5 });
  });

  test('an injected inline handler or unhashed script does not run', async () => {
    const injected = page.replace('<h3>Impact diagram</h3>', '<h3>Impact diagram</h3><img src="data:," onerror="window.__pwned=1"><script>window.__pwned=2</script>');
    await b.open(injected, AT_IMPACT);
    assert.equal(await b.eval('window.__pwned ?? null'), null);
    assert.ok((await b.eval('window.__cspViolations')).length >= 2);
    assert.equal(await b.eval(`document.querySelectorAll('g.node[tabindex]').length`), model.nodes.length, 'the hashed script still runs');
  });

  for (const width of [1280, 390]) {
    for (const dark of [false, true]) {
      test(`${width}px ${dark ? 'dark' : 'light'}: no page-level horizontal overflow; wide graphs scroll in their container; readable text`, async () => {
        for (const [name, doc] of [['sample', render(sampleManifest(), { excerpts: [], stale: [] }, { interactive: true })], ['derived', page]]) {
          await b.open(doc, { width, dark, ...AT_IMPACT });
          await b.click('div.impact-graph g.node[data-node="n0"]');
          const r = await b.eval(`(() => {
            const rgb = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return m.length === 4 && m[3] === 0 ? null : m.slice(0, 3); };
            const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
            const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
            const bg = (e) => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c) return c; } return [255, 255, 255]; };
            const contrast = (sel) => { const e = document.querySelector(sel); return ratio(rgb(getComputedStyle(e).color), bg(e)); };
            const scroll = document.querySelector('div.impact-graph .diagram-scroll');
            const sel = document.querySelector('g.node.is-selected');
            return {
              overflow: document.documentElement.scrollWidth - innerWidth,
              svgWidth: Number(document.querySelector('div.impact-graph svg').getAttribute('width')),
              scrolls: scroll.scrollWidth > scroll.clientWidth,
              contrast: {
                hint: contrast('.impact-hint'), status: contrast('.impact-status'), reset: contrast('button.impact-reset'),
                details: contrast('.impact-details li'), heading: contrast('.impact-details h4'),
                node: ratio(rgb(getComputedStyle(sel.querySelector('text.label')).fill), rgb(getComputedStyle(sel.querySelector('rect')).fill)),
              },
              panelFits: document.querySelector('.impact-details').getBoundingClientRect().right <= innerWidth,
            };
          })()`);
          assert.ok(r.overflow <= 0, `${name}: page overflows by ${r.overflow}px`);
          assert.ok(r.panelFits, `${name}: details panel fits`);
          if (width === 390 && r.svgWidth > 480) assert.ok(r.scrolls, `${name}: the ${r.svgWidth}px graph scrolls in its container`);
          for (const [what, c] of Object.entries(r.contrast)) assert.ok(c >= 4.5, `${name} ${what}: contrast ${c.toFixed(2)}`);
        }
        assert.deepEqual(await b.eval('window.__cspViolations'), []);
      });
    }
  }
});
