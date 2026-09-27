// The documentation layout and presentation modes (src/render/layout.js,
// overview.js, presentation.js). No browser: markup, anchors, the page
// rules, the modes and the CLI flag. test/layout-browser.test.js checks the
// behavior in headless Chrome.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { render, RenderError } from '../src/render/render.js';
import { escapeHtml } from '../src/render/escape.js';
import { flowOrder } from '../src/render/overview.js';
import { validateManifest } from '../src/validation/validate.js';
import { ROOT, sampleManifest, minimalManifest, derivedImpactManifest, staleEntry, sampleRepoCopy, tempDir } from './helpers.js';

const none = { excerpts: [], stale: [] };
const PAYLOAD = `<img src=x onerror="alert(1)">'&</a><script>alert(2)</script><style>*{}</style>`;

const styleOf = (out) => out.slice(out.indexOf('<style>') + 7, out.indexOf('</style>'));
const ids = (out) => [...out.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
const hrefs = (out) => [...out.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
const navOf = (out) => out.slice(out.indexOf('<nav class="sidebar"'), out.indexOf('</nav>'));
const decode = (s) => s.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

describe('layout: pages and sidebar', () => {
  test('one overview page, then one page per section in manifest order, then the appendices', () => {
    const m = sampleManifest();
    const out = render(m, none);
    const pages = [...out.matchAll(/<div class="page[^"]*" id="page-(\d+)">/g)].map((x) => Number(x[1]));
    // The first section is an overview: it is embedded in page 0.
    assert.deepEqual(pages, m.documentation.sections.slice(0).map((_, i) => i));
    const pageOfSection = (id) => {
      const at = out.indexOf(`<section id="section-${id}"`);
      return Number([...out.slice(0, at).matchAll(/id="page-(\d+)"/g)].at(-1)[1]);
    };
    assert.equal(pageOfSection('overview'), 0);
    m.documentation.sections.slice(1).forEach((s, i) => assert.equal(pageOfSection(s.id), i + 1, s.id));

    const minimal = render(minimalManifest(), none);
    assert.deepEqual([...minimal.matchAll(/id="page-(\d+)"/g)].map((x) => x[1]), ['0', '1', '2'], 'overview, then the unknowns and evidence appendices');
  });

  test('a first section that is not an overview gets a page of its own', () => {
    const m = sampleManifest();
    m.documentation.sections.reverse();
    const out = render(m, none);
    assert.ok(!out.slice(out.indexOf('id="page-0"'), out.indexOf('id="page-1"')).includes('<section id="section-'));
    assert.equal((out.match(/<div class="page(?: page-home)?" id=/g) ?? []).length, m.documentation.sections.length + 1);
  });

  test('the sidebar groups sections by kind, in reading order, and shows only groups with content', () => {
    const out = render(sampleManifest(), none);
    const nav = navOf(out);
    const headings = [...nav.matchAll(/<p class="nav-heading" id="nav-group-([a-z]+)">([^<]+)<\/p>/g)].map((x) => x[1]);
    assert.deepEqual(headings, ['overview', 'architecture', 'behavior', 'quality', 'notes', 'reference']);
    const links = [...nav.matchAll(/<a class="nav-link nav-(\d+)" href="([^"]+)">/g)].map((x) => x[2]);
    assert.deepEqual(links, ['#page-0', '#section-scope', '#section-architecture', '#section-implementation', '#section-impact',
      '#section-flows', '#section-risks', '#section-testing', '#section-unknowns', '#section-team-notes', '#section-references', '#section-history']);
    assert.match(nav, /Team notes <span class="badge manual">manual<\/span>/);

    const minimal = navOf(render(minimalManifest(), none));
    assert.deepEqual([...minimal.matchAll(/id="nav-group-([a-z]+)"/g)].map((x) => x[1]), ['overview', 'quality', 'reference'], 'no empty groups');
    assert.ok(!/Architecture|Behavior|Notes/.test(minimal));
  });

  test('diagrams are listed under their page in the sidebar, once each, and only when a section shows them', () => {
    const m = sampleManifest();
    const nav = navOf(render(m, none));
    for (const [type, tag] of [['architecture', 'Architecture view'], ['executionFlows', 'Execution flow'], ['sequences', 'Sequence'], ['stateMachines', 'State machine'], ['dataFlows', 'Data flow']]) {
      for (const v of m.visualizations[type]) assert.equal(nav.split(`href="#viz-${v.id}">${escapeHtml(v.title)} <span class="nav-tag">${tag}</span>`).length - 1, 1, v.id);
    }
    m.documentation.sections.find((s) => s.id === 'flows').visualizations = [];
    const out = render(m, none);
    assert.ok(!navOf(out).includes('#viz-seq-pay'));
    assert.ok(!out.includes('id="viz-seq-pay"'));
  });

  test('every link in the document points at an id that exists, in both modes', () => {
    for (const m of [sampleManifest(), minimalManifest(), derivedImpactManifest()]) {
      for (const mode of ['developer', 'product']) {
        const out = render(m, { excerpts: [], stale: m.evidence.length ? [staleEntry(m, m.evidence[0].id)] : [] }, { mode });
        const known = new Set(ids(out));
        const all = ids(out);
        assert.equal(all.length, known.size, `${mode}: ids are unique`);
        for (const h of hrefs(out)) {
          assert.ok(h.startsWith('#'), h);
          assert.ok(known.has(decode(h.slice(1))), `${mode}: dead link ${h}`);
        }
      }
    }
  });

  test('each page has a skip link, a menu link, a drawer close link and a return anchor, all index-based', () => {
    const out = render(sampleManifest(), none);
    const n = (out.match(/<div class="page(?: page-home)?" id=/g) ?? []).length;
    for (let i = 0; i < n; i++) {
      assert.ok(out.includes(`<a class="skip skip-${i}" href="#back-${i}">Skip to content</a>`));
      assert.ok(out.includes(`<a class="menu-link menu-link-${i}" href="#menu-${i}" aria-controls="sidebar">Menu</a>`));
      assert.ok(out.includes(`<a class="drawer-close" id="menu-${i}" href="#back-${i}">Close menu</a>`));
      assert.ok(out.includes(`<span class="page-anchor" id="back-${i}"></span>`));
    }
    assert.ok(out.indexOf('class="skip skip-0"') < out.indexOf('class="topbar"'), 'skip links come first');
  });

  test('previous and next links follow the sidebar order', () => {
    const out = render(sampleManifest(), none);
    const page = (i) => out.slice(out.indexOf(`id="page-${i}"`), out.indexOf(`id="page-${i + 1}"`) === -1 ? undefined : out.indexOf(`id="page-${i + 1}"`));
    assert.match(page(0), /<div class="pager">\n<a class="pager-next" href="#section-scope">/);
    assert.ok(!page(0).includes('pager-prev'));
    assert.match(page(1), /<a class="pager-prev" href="#page-0">[\s\S]*<a class="pager-next" href="#section-architecture">/);
  });
});

describe('layout: page rules', () => {
  test('the stylesheet shows one page at a time with :has() and :target, using page indexes only', () => {
    const style = styleOf(render(sampleManifest(), none));
    assert.match(style, /@supports selector\(:has\(\*\)\)\{\n\.page,\.skip\{display:none\}/);
    assert.ok(style.includes(':is(body:has(#page-0:target,#page-0 :target,#menu-0:target),body:not(:has(.page:target,.page :target,.drawer-close:target))) #page-0{display:block}'));
    assert.ok(style.includes('body:has(#page-3:target,#page-3 :target,#menu-3:target) #page-3{display:block}'));
    for (const [, sel] of style.matchAll(/#([a-z]+-[\w-]*)/g)) assert.match(sel, /^(page|menu)-\d+$/, sel);
  });

  test('manifest text never reaches the stylesheet: hostile ids and titles give the same stylesheet', () => {
    const m = sampleManifest();
    const hostile = sampleManifest();
    for (const s of hostile.documentation.sections) {
      s.title = `${PAYLOAD} ${s.title}`;
    }
    hostile.metadata.feature.name = PAYLOAD;
    for (const v of hostile.visualizations.sequences) v.title = PAYLOAD;
    assert.equal(styleOf(render(hostile, none)), styleOf(render(m, none)));
    assert.equal(styleOf(render(hostile, none, { mode: 'product' })), styleOf(render(m, none, { mode: 'product' })));
  });

  test('hostile section, finding, risk, unknown and visualization ids and labels stay escaped in the sidebar, pages and overview', () => {
    const m = sampleManifest();
    const bad = (id) => `${id}" onclick="x`;
    // Section, finding, risk, unknown and visualization ids, and every reference to them.
    for (const s of m.documentation.sections) {
      for (const f of m.analysis.findings) if (f.section === s.id) f.section = bad(s.id);
      s.visualizations = s.visualizations?.map(bad);
      s.id = bad(s.id);
    }
    for (const list of [m.analysis.findings, m.analysis.risks, m.analysis.unknowns]) for (const x of list) x.id = bad(x.id);
    for (const list of Object.values(m.visualizations)) for (const v of list) v.id = bad(v.id);
    m.analysis.findings[1].title = PAYLOAD;
    m.analysis.risks[0].title = PAYLOAD;
    m.analysis.unknowns[0].statement = PAYLOAD;
    m.visualizations.executionFlows[0].steps[0].label = PAYLOAD;
    m.visualizations.executionFlows[0].steps[1].next[0].condition = PAYLOAD;
    m.metadata.repository.branch = PAYLOAD;
    for (const mode of ['developer', 'product']) {
      const out = render(m, none, { mode });
      assert.ok(!out.includes(PAYLOAD), mode);
      assert.ok(out.includes(escapeHtml(PAYLOAD)), mode);
      assert.ok(!/<script|<img|<style>\*/i.test(out), mode);
      for (const [tag] of out.matchAll(/<[a-zA-Z][^>]*>/g)) assert.ok(!/\son[a-z]+\s*=/i.test(tag.replace(/"[^"]*"/g, '""')), tag);
      assert.ok(navOf(out).includes('href="#section-flows&quot; onclick=&quot;x"'), 'section id escaped in the sidebar');
      assert.ok(navOf(out).includes('href="#viz-seq-pay&quot; onclick=&quot;x"'), 'visualization id escaped in the sidebar');
      assert.ok(out.includes(`href="#risk-${escapeHtml(m.analysis.risks[0].id)}"`), 'risk id escaped on the overview');
    }
  });
});

describe('presentation modes', () => {
  test('developer is the default', () => {
    const m = sampleManifest();
    const out = render(m, none);
    assert.equal(render(m, none, { mode: 'developer' }), out);
    assert.match(out, /<body class="mode-developer">/);
    assert.ok(out.includes('<span class="chip chip-mode">Developer view</span>'));
  });

  test('an unknown mode is refused', () => {
    for (const mode of ['Product', 'dev', '', null, 1]) assert.throws(() => render(sampleManifest(), none, { mode }), RenderError, String(mode));
  });

  test('developer view: certainty, sources with symbols, component details and code are open', () => {
    const m = sampleManifest();
    const out = render(m, none);
    const f = m.analysis.findings.find((x) => x.id === 'f-overview');
    assert.ok(out.includes(`<li id="finding-${f.id}"><p class="claim-head"><span class="badge certainty-observed">observed</span> ${escapeHtml(f.title)}</p>`));
    const ev = m.evidence.find((e) => e.symbol);
    assert.ok(out.includes(`<a class="ref" href="#evidence-${ev.id}"><code>${ev.file}:${ev.startLine}-${ev.endLine}</code></a> <span class="ref-sym"><code>${escapeHtml(ev.symbol)}</code></span>`));
    assert.ok(!out.includes('<details class="tech">'), 'no claim detail is hidden');
    assert.match(out, /<h3>Relationships \(\d+\)<\/h3>/);
    assert.ok(out.includes('<h2 class="card-title">Where it lives</h2>'));
    assert.ok(!out.includes('<h2 class="card-title">How it works</h2>'));
  });

  test('product view: plain certainty words, technical details collapsed, and the first execution flow as steps', () => {
    const m = sampleManifest();
    const out = render(m, none, { mode: 'product' });
    assert.match(out, /<body class="mode-product">/);
    assert.ok(out.includes('<span class="chip chip-mode">Product view</span>'));
    assert.ok(out.includes('<span class="badge certainty-observed">Read in code</span>'));
    assert.ok(out.includes('<details class="tech"><summary>Technical details'));
    assert.ok(out.includes('Certainty: <strong>observed</strong>. Read directly in the cited lines.'));
    assert.match(out, /<details class="more"><summary>How the parts connect \(\d+\)<\/summary>/);
    assert.ok(out.includes('<details class="text-version">'));
    assert.ok(!out.includes('Where it lives'));

    const flow = m.visualizations.executionFlows[0];
    const steps = out.slice(out.indexOf('<ol class="steps">'), out.indexOf('</ol>', out.indexOf('<ol class="steps">')));
    const labels = [...steps.matchAll(/<span class="step-label">([^<]*)<\/span>/g)].map((x) => x[1]);
    assert.deepEqual(labels, flowOrder(flow).slice(0, 8).map((s) => escapeHtml(s.label)));
    assert.equal(labels[0], escapeHtml(flow.steps.find((s) => s.id === flow.start).label), 'starts at the start step');
    assert.ok(steps.includes('<span class="cond">yes</span>'), 'branch conditions come from the manifest');
  });

  test('flowOrder: breadth first from the start, each step once, unreachable steps left out', () => {
    const flow = { start: 'a', steps: [
      { id: 'z', label: 'Z' },
      { id: 'c', label: 'C', next: [{ to: 'a' }] },
      { id: 'a', label: 'A', next: [{ to: 'b' }, { to: 'c' }, { to: 'ghost' }] },
      { id: 'b', label: 'B', next: [{ to: 'c' }] },
    ] };
    assert.deepEqual(flowOrder(flow).map((s) => s.id), ['a', 'b', 'c']);
    assert.deepEqual(flowOrder({ start: 'nope', steps: flow.steps }), []);
  });

  test('both modes show the same claims, certainty and evidence', () => {
    const m = sampleManifest();
    const inputs = { excerpts: [], stale: [staleEntry(m, 'ev-route')] };
    const dev = render(m, inputs);
    const prod = render(m, inputs, { mode: 'product' });
    const texts = [
      ...m.analysis.findings.flatMap((f) => [f.title, f.body]),
      ...m.analysis.components.flatMap((x) => [x.name, x.summary]),
      ...m.analysis.risks.flatMap((r) => [r.title, r.body]),
      ...m.analysis.testing.flatMap((r) => [r.title, r.body]),
      ...m.analysis.unknowns.flatMap((u) => [u.statement, u.reason]),
      ...m.analysis.impact.items.map((i) => i.reason),
      ...m.analysis.files.map((f) => f.path),
      ...m.evidence.map((e) => e.explanation),
    ];
    for (const t of texts) {
      assert.ok(dev.includes(escapeHtml(t)), `developer: ${t}`);
      assert.ok(prod.includes(escapeHtml(t)), `product: ${t}`);
    }
    const certainties = (out) => [...out.matchAll(/badge certainty-(\w+)|Certainty: <strong>(\w+)<\/strong>/g)].length;
    assert.ok(certainties(prod) >= m.analysis.findings.length + m.analysis.components.length + m.analysis.risks.length);
    const cited = (out) => new Set([...out.matchAll(/href="#evidence-([^"]+)"/g)].map((x) => x[1]));
    assert.deepEqual([...cited(prod)].sort(), [...cited(dev)].sort());
    const anchored = (out) => [...out.matchAll(/<article class="evidence[^"]*" id="evidence-([^"]+)"/g)].map((x) => x[1]).sort();
    assert.deepEqual(anchored(prod), anchored(dev));
    assert.deepEqual(anchored(dev), m.evidence.map((e) => e.id).sort());
    for (const out of [dev, prod]) {
      assert.ok(out.includes('unverified: changed'));
      assert.ok(!/<script/i.test(out));
    }
  });

  test('both modes are deterministic, static and keep the same CSP', () => {
    for (const mode of ['developer', 'product']) {
      const a = render(sampleManifest(), none, { mode });
      assert.equal(render(sampleManifest(), none, { mode }), a);
      assert.ok(a.includes(`content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`));
      assert.equal((a.match(/<style>/g) ?? []).length, 1);
    }
  });

  test('interactive product view still carries exactly the one hashed impact script', () => {
    const out = render(derivedImpactManifest(), none, { mode: 'product', interactive: true });
    assert.equal((out.match(/<script>/g) ?? []).length, 1);
    assert.ok(out.includes('<div class="impact-graph">'));
  });
});

describe('overview page', () => {
  test('answers what, how and where: hero, key facts, summary and links onward', () => {
    const m = sampleManifest();
    const out = render(m, none);
    const home = out.slice(out.indexOf('id="page-0"'), out.indexOf('id="page-1"'));
    assert.ok(home.includes(`<h1>${escapeHtml(m.metadata.feature.name)}</h1>`));
    assert.ok(home.includes('<ul class="facts" aria-label="Key facts">'));
    assert.ok(home.includes(`<span class="fact-n">${m.analysis.risks.length}</span> <span class="fact-l">risks</span>`));
    assert.ok(home.includes('<section id="section-overview"'), 'the overview section is the summary');
    for (const f of m.analysis.findings.filter((x) => x.section !== 'overview')) assert.ok(home.includes(`href="#finding-${f.id}"`), f.id);
    assert.ok(home.includes('<h2 class="card-title">Risks to know</h2>'));
    assert.ok(home.includes('<h2 class="card-title">Diagrams</h2>'));
    assert.ok(home.includes('evidence current'));
    assert.ok(!home.includes('<pre'), 'no code on the overview');
  });

  test('empty facts and cards are left out', () => {
    const out = render(minimalManifest(), none);
    const home = out.slice(out.indexOf('id="page-0"'), out.indexOf('id="page-1"'));
    assert.ok(!/Risks to know|Key findings|Diagrams|Where it lives/.test(home));
    assert.deepEqual([...home.matchAll(/<span class="fact-l">([^<]+)<\/span>/g)].map((x) => x[1]), ['unknowns']);
    assert.ok(home.includes('no evidence'));
  });

  test('stale evidence is announced on the overview', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: [], stale: [staleEntry(m, 'ev-route')] });
    const home = out.slice(out.indexOf('id="page-0"'), out.indexOf('id="page-1"'));
    assert.ok(home.includes(`<span class="badge unverified">1 unverified</span> 1 of ${m.evidence.length} cited source location(s) no longer match the code`));
  });

  test('old manifests still validate and render: no schema change', () => {
    for (const m of [sampleManifest(), minimalManifest(), derivedImpactManifest()]) {
      assert.equal(validateManifest(m).valid, true);
      for (const mode of ['developer', 'product']) assert.ok(render(m, none, { mode }).startsWith('<!doctype html>'));
    }
  });
});

describe('render --mode', () => {
  const CLI = path.join(ROOT, 'bin/featurelens.js');

  function run(t, ...extra) {
    const repo = sampleRepoCopy(t);
    const inputs = tempDir(t);
    const manifestFile = path.join(inputs, 'manifest.json');
    const excerptFile = path.join(inputs, 'excerpts.json');
    fs.writeFileSync(manifestFile, JSON.stringify(sampleManifest()));
    fs.writeFileSync(excerptFile, '[]');
    const r = spawnSync(process.execPath, [CLI, 'render', manifestFile, '--repo', repo, '--excerpts', excerptFile, '--json', ...extra], { encoding: 'utf8' });
    const file = path.join(repo, 'docs/features/payment-flow/index.html');
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, html: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
  }

  test('defaults to developer and reports the mode', (t) => {
    const r = run(t);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).mode, 'developer');
    assert.match(r.html, /<body class="mode-developer">/);
  });

  test('--mode product writes the product view through the same gate and writer', (t) => {
    const r = run(t, '--mode', 'product');
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).mode, 'product');
    assert.match(r.html, /<body class="mode-product">/);
    assert.match(r.html.split('\n')[1], /^<!-- featurelens \{/, 'stamped by the writer');
    assert.ok(!/<script/i.test(r.html));
  });

  test('an unknown mode is a usage error and writes nothing', (t) => {
    const r = run(t, '--mode', 'marketing');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--mode must be one of developer, product/);
    assert.equal(r.html, null);
  });

  test('the usage documents the flag', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).stdout;
    assert.match(help, /\[--mode developer\|product\]/);
    assert.match(help, /--mode picks the presentation \(default developer\)/);
  });
});
