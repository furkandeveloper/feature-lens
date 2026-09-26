// Phase 3D: the opt-in interactive impact graph (ARCHITECTURE.md §6.1.4).
// These tests need no browser: output compatibility, CSP, escaping, the
// script's text and the references it reads. test/interactive-browser.test.js
// checks the behavior in headless Chrome.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { render, RenderError } from '../src/render/render.js';
import { escapeHtml } from '../src/render/escape.js';
import { IMPACT_SCRIPT, IMPACT_SCRIPT_HASH, INTERACTIVE_STYLE } from '../src/render/interactive.js';
import { impactDiagram } from '../src/analysis/diagram-model.js';
import { validateManifest } from '../src/validation/validate.js';
import { ROOT, sampleManifest, minimalManifest, sampleRepoCopy, tempDir, derivedImpactManifest as derivedManifest, staleEntry } from './helpers.js';

const PAYLOAD = `<img src=x onerror="alert(1)">'&</text><script>alert(2)</script><!-- featurelens {} -->`;
const STATIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
const none = { excerpts: [], stale: [] };
/** The interactive document with everything interactive mode adds taken out again. */
function strip(out) {
  return out
    .replace(escapeHtml(interactiveCsp()), escapeHtml(STATIC_CSP))
    .replace(INTERACTIVE_STYLE, '')
    .replace(`<script>${IMPACT_SCRIPT}</script>\n`, '')
    .replace(/ data-(?:node|source|target)="n\d+"/g, '')
    .replace(/<div class="impact-graph">\n([\s\S]*?)\n<\/div>(?=\n<h3>Direct impact<\/h3>)/g, '$1');
}

function interactiveCsp() {
  return `default-src 'none'; script-src ${IMPACT_SCRIPT_HASH}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
}

function cspOf(out) {
  const metas = [...out.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
  assert.equal(metas.length, 1, 'one CSP');
  return metas[0][1].replaceAll('&#39;', "'");
}

const scriptsOf = (out) => [...out.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

function cases() {
  const stale = (m) => ({ excerpts: [], stale: [staleEntry(m, 'ev-route')] });
  const s = sampleManifest();
  const d = derivedManifest();
  return [
    ['sample', sampleManifest(), none],
    ['sample, stale route', s, stale(s)],
    ['derived', d, stale(d)],
  ];
}

describe('interactive impact graph: static output is unchanged', () => {
  test('without the option, or with interactive: false, the output is the Phase 3C output', () => {
    for (const [name, m, inputs] of cases()) {
      const plain = render(m, inputs);
      assert.equal(render(m, inputs, {}), plain, name);
      assert.equal(render(m, inputs, { interactive: false }), plain, name);
      assert.equal(scriptsOf(plain).length, 0, name);
      assert.equal(cspOf(plain), STATIC_CSP, name);
      assert.ok(!/data-(?:node|source|target)=|impact-graph|impact-toolbar/.test(plain), name);
    }
  });

  test('a document that draws no impact diagram is byte-identical in interactive mode: no script, no CSP change', () => {
    const noImpact = sampleManifest();
    noImpact.analysis.impact.items = [];
    noImpact.analysis.impact.relationships = [];
    const manualImpact = sampleManifest();
    manualImpact.documentation.sections.find((s) => s.kind === 'impact').origin = 'manual';
    for (const m of [minimalManifest(), noImpact, manualImpact]) {
      assert.equal(render(m, none, { interactive: true }), render(m, none));
    }
  });

  test('interactive output is the static output plus the wrapper, data references, style, script and script hash, nothing else', () => {
    for (const [name, m, inputs] of cases()) {
      const out = render(m, inputs, { interactive: true });
      assert.notEqual(out, render(m, inputs), name);
      assert.equal(strip(out), render(m, inputs), name);
    }
  });

  test('only the impact diagram carries references; architecture views and flow diagrams are untouched', () => {
    const out = render(derivedManifest(), none, { interactive: true });
    const wrapped = [...out.matchAll(/<div class="impact-graph">[\s\S]*?(?=\n<h3>Direct impact<\/h3>)/g)].map((x) => x[0]);
    assert.equal(wrapped.length, 1);
    const outside = out.replace(wrapped[0], '');
    assert.ok(!/data-(?:node|source|target)=/.test(outside));
    assert.equal((out.match(/<svg /g) ?? []).length, 6, 'impact, architecture and four flow diagrams');
  });

  test('deterministic byte for byte, including the script and its hash', () => {
    for (const [name, m, inputs] of cases()) {
      assert.equal(render(m, inputs, { interactive: true }), render(structuredClone(m), structuredClone(inputs), { interactive: true }), name);
    }
  });

  test('rejects an option that is not a boolean', () => {
    for (const interactive of ['yes', 1, null]) {
      assert.throws(() => render(sampleManifest(), none, { interactive }), RenderError);
    }
  });
});

describe('interactive impact graph: CSP and script', () => {
  const out = render(derivedManifest(), none, { interactive: true });

  test('the CSP adds exactly one script-src: the hash of the one inline script', () => {
    const scripts = scriptsOf(out);
    assert.equal(scripts.length, 1);
    const [, attrs, body] = scripts[0];
    assert.equal(attrs, '', 'no src, type, nonce or other attributes');
    assert.equal(body, IMPACT_SCRIPT);
    const hash = `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    const directives = Object.fromEntries(cspOf(out).split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(directives, {
      'default-src': ["'none'"],
      'script-src': [hash],
      'style-src': ["'unsafe-inline'"],
      'img-src': ['data:'],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
    assert.equal(IMPACT_SCRIPT_HASH, hash);
  });

  test('the script is the last thing in <body>, after all static content', () => {
    assert.ok(out.endsWith(`</footer>\n<script>${IMPACT_SCRIPT}</script>\n</body>\n</html>\n`));
  });

  test('the script embeds no data, builds no markup from strings and uses no eval, network or storage', () => {
    assert.ok(!IMPACT_SCRIPT.includes('<'), 'no markup, no "</script" or "<!--"');
    for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval', 'Function(', 'setTimeout', 'setInterval',
      'import(', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'navigator', 'location', 'localStorage', 'sessionStorage',
      'indexedDB', 'postMessage', 'open(', 'href', 'src', 'style.', 'setAttribute(\'on', 'http', '//']) {
      assert.ok(!IMPACT_SCRIPT.includes(banned), banned);
    }
    // Every attribute it sets is one of these, with a value it computes.
    const set = [...IMPACT_SCRIPT.matchAll(/setAttribute\('([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual([...new Set(set)].sort(), ['aria-label', 'aria-pressed', 'role', 'tabindex']);
  });

  test('no inline event handlers anywhere in the document', () => {
    for (const [whole] of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
      assert.ok(!/\son[a-z]+\s*=/i.test(whole.replace(/"[^"]*"/g, '""')), whole);
    }
  });

  test('the style adds selection cues that are not color: border width, dimming, bold label; and a focus outline', () => {
    const rule = (selector) => {
      const found = INTERACTIVE_STYLE.match(new RegExp(`(?:^|[}\\n,])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,[^{}]*)?\\{([^}]*)\\}`));
      assert.ok(found, selector);
      return found[1];
    };
    assert.match(rule('svg.diagram g.node.is-selected rect'), /stroke-width:4\.5/);
    assert.match(rule('svg.diagram g.node.is-selected text.label'), /font-weight:700/);
    assert.match(rule('.impact-graph.has-selection svg.diagram g.node'), /opacity:\.3/);
    assert.match(rule('svg.diagram g.edge.is-incoming .line'), /stroke-width:3/);
    assert.match(rule('svg.diagram g.node:focus-visible'), /outline:3px solid/);
    assert.ok(!/transition|animation|@keyframes/.test(INTERACTIVE_STYLE), 'no animation');
    assert.ok(!/url\(|@import|https?:/.test(INTERACTIVE_STYLE));
  });
});

describe('interactive impact graph: references and escaping', () => {
  test('references are model positions, consistent between the SVG and the text version', () => {
    const m = derivedManifest();
    const out = render(m, none, { interactive: true });
    const model = impactDiagram(m);
    const ref = new Map(model.nodes.map((n, i) => [n.id, `n${i}`]));
    const graph = out.slice(out.indexOf('<div class="impact-graph">'), out.indexOf('<h3>Direct impact</h3>'));
    const svg = graph.slice(graph.indexOf('<svg'), graph.indexOf('</svg>'));
    const text = graph.slice(graph.indexOf('<div class="diagram-summary">'));

    assert.deepEqual([...svg.matchAll(/<g class="node[^"]*" data-node="(n\d+)">/g)].map((x) => x[1]), [...ref.values()]);
    assert.deepEqual([...text.matchAll(/<li data-node="(n\d+)">/g)].map((x) => x[1]), [...ref.values()]);
    assert.deepEqual([...text.matchAll(/<li data-source="(n\d+)" data-target="(n\d+)">/g)].map((x) => [x[1], x[2]]),
      model.edges.map((e) => [ref.get(e.source), ref.get(e.target)]));
    const drawn = new Set(model.edges.filter((e) => e.source !== e.target).map((e) => `${ref.get(e.source)} ${ref.get(e.target)}`));
    const svgEdges = [...svg.matchAll(/<g class="edge[^"]*" data-source="(n\d+)" data-target="(n\d+)">/g)].map((x) => `${x[1]} ${x[2]}`);
    assert.deepEqual(new Set(svgEdges), drawn);
    assert.ok(model.edges.some((e) => e.basis === 'derived') && model.nodes.some((n) => n.impact === 'derived'), 'the fixture has derived items');
  });

  test('hostile ids and labels never reach a reference; they stay escaped text', () => {
    // Every component id, wherever the manifest uses it, becomes a hostile one.
    let json = JSON.stringify(derivedManifest());
    for (const c of derivedManifest().analysis.components) json = json.replaceAll(JSON.stringify(c.id), JSON.stringify(`${c.id}" onclick="alert(1)${PAYLOAD}`));
    const m = JSON.parse(json);
    for (const c of m.analysis.components) c.name = `${c.name} ${PAYLOAD}`;
    for (const r of m.analysis.relationships) r.label = PAYLOAD;
    for (const r of m.analysis.impact.relationships) r.reason = PAYLOAD;
    const out = render(m, none, { interactive: true });

    assert.ok(!out.includes(PAYLOAD));
    assert.ok(out.includes(escapeHtml(PAYLOAD)));
    for (const [, v] of out.matchAll(/ data-[a-z-]+="([^"]*)"/g)) assert.match(v, /^n\d+$/);
    assert.equal(scriptsOf(out).length, 1);
    assert.equal(scriptsOf(out)[0][2], IMPACT_SCRIPT);
    for (const [whole] of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
      assert.ok(!/\son[a-z]+\s*=/i.test(whole.replace(/"[^"]*"/g, '""')), whole);
    }
  });

  test('stale evidence stays unverified in the text the details panel copies', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: [], stale: [staleEntry(m, 'ev-route')] }, { interactive: true });
    const route = impactDiagram(m).nodes.findIndex((n) => n.id === 'pay-route');
    const item = out.match(new RegExp(`<li data-node="n${route}">[\\s\\S]*?</li>`))[0];
    assert.match(item, /<span class="badge unverified">unverified<\/span>/);
    assert.ok(out.includes(`<g class="node direct unverified" data-node="n${route}">`));
  });

  test('unknown evidence ids still fail in interactive mode', () => {
    const m = sampleManifest();
    m.analysis.impact.items[0].evidence = ['ev-nope'];
    assert.equal(validateManifest(m).valid, false);
    assert.throws(() => render(m, none, { interactive: true }), (e) => e instanceof RenderError && /unknown evidence id "ev-nope"/.test(e.message));
  });

  test('no schema change: the fixtures are still valid', () => {
    assert.equal(validateManifest(sampleManifest()).valid, true);
    assert.equal(validateManifest(derivedManifest()).valid, true);
  });
});

describe('render --interactive', () => {
  const CLI = path.join(ROOT, 'bin/featurelens.js');

  function run(t, ...extra) {
    const repo = sampleRepoCopy(t);
    const inputs = tempDir(t);
    const manifestFile = path.join(inputs, 'manifest.json');
    const excerptFile = path.join(inputs, 'excerpts.json');
    fs.writeFileSync(manifestFile, JSON.stringify(sampleManifest()));
    fs.writeFileSync(excerptFile, '[]');
    const r = spawnSync(process.execPath, [CLI, 'render', manifestFile, '--repo', repo, '--excerpts', excerptFile, '--json', ...extra], { encoding: 'utf8' });
    const html = fs.readFileSync(path.join(repo, 'docs/features/payment-flow/index.html'), 'utf8');
    return { status: r.status, report: JSON.parse(r.stdout), html };
  }

  test('writes the interactive document through the same gate and writer; without the flag, the static one', (t) => {
    const on = run(t, '--interactive');
    assert.equal(on.status, 0);
    assert.equal(on.report.interactive, true);
    assert.equal(scriptsOf(on.html).length, 1);
    assert.match(on.html.split('\n')[1], /^<!-- featurelens \{/, 'stamped by the writer');
    const off = run(t);
    assert.equal(off.status, 0);
    assert.equal(off.report.interactive, false);
    assert.equal(scriptsOf(off.html).length, 0);
  });

  test('the usage documents the flag', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).stdout;
    assert.match(help, /\[--interactive\]/);
    assert.match(help, /--interactive adds keyboard-accessible node selection to the impact\s+diagram/);
  });
});
