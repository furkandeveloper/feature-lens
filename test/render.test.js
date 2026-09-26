import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import { render, RenderError, SECTION_KINDS } from '../src/render/render.js';
import { excerptHash } from '../src/render/inputs.js';
import { escapeHtml, html } from '../src/render/escape.js';
import { SourceTree, hashSnippet } from '../src/evidence/source.js';
import { stampDocument, readMarker } from '../src/output/marker.js';
import { ROOT, SAMPLE_REPO, sampleManifest, minimalManifest } from './helpers.js';

const PAYLOAD = `<img src=x onerror="alert(1)">'&</p><script>alert(2)</script><!-- featurelens {} -->`;
const ESCAPED = escapeHtml(PAYLOAD);

/** What Claude Code would supply: the cited lines of each evidence entry, read from the sample repository. */
function sampleExcerpts(manifest, skip = []) {
  const tree = new SourceTree(SAMPLE_REPO);
  return manifest.evidence.filter((e) => !skip.includes(e.id)).map((e) => ({
    evidenceId: e.id,
    file: e.file,
    startLine: e.startLine,
    endLine: e.endLine,
    text: tree.lines(e.file).slice(e.startLine - 1, e.endLine).join('\n'),
  }));
}

function staleEntry(manifest, evidenceId, extra = {}) {
  const i = manifest.evidence.findIndex((e) => e.id === evidenceId);
  return {
    evidenceId, path: `/evidence/${i}`, file: manifest.evidence[i].file, status: 'changed', action: 'reanalyze',
    claims: [], manualSections: [], manualOnly: false, message: `${manifest.evidence[i].file} changed`, ...extra,
  };
}

/** The HTML of one section, from its opening tag to the next section. */
function sectionHtml(out, id) {
  const start = out.indexOf(`<section id="section-${id}"`);
  assert.notEqual(start, -1, `section ${id} rendered`);
  return out.slice(start, out.indexOf('</section>', start));
}

/** Every attribute value that could load or navigate somewhere. */
function urlAttributes(out) {
  return [...out.matchAll(/\s(href|src|srcset|action|formaction|poster|data|background|xlink:href)\s*=\s*"([^"]*)"/gi)].map((m) => m[2]);
}

/** Tag names of every element in the output. */
function tags(out) {
  return new Set([...out.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase()));
}

const ALLOWED_TAGS = ['html', 'head', 'meta', 'title', 'style', 'body', 'header', 'h1', 'h2', 'h3', 'p', 'dl', 'dt', 'dd', 'code',
  'span', 'ul', 'ol', 'li', 'nav', 'a', 'main', 'section', 'div', 'article', 'pre', 'figure', 'figcaption', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'br', 'footer', 'h4', 'svg', 'g', 'rect', 'text', 'tspan', 'path'];

describe('escaping helpers', () => {
  test('escapeHtml escapes & < > " \'', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    assert.equal(escapeHtml('&amp;'), '&amp;amp;', 'escapes already-escaped text again');
  });

  test('html escapes interpolations but not its own fragments', () => {
    const inner = html`<b>${'<i>'}</b>`;
    assert.equal(String(html`<p>${inner}${['<', html`<br>`]}${null}${undefined}${false}${0}</p>`), '<p><b>&lt;i&gt;</b>&lt;<br>0</p>');
    assert.equal(String(html`${{ markup: '<x>' }}`), '[object Object]', 'look-alike objects are escaped');
  });
});

describe('render: document', () => {
  test('renders the minimal manifest as a complete document without a marker', () => {
    const out = render(minimalManifest(), { excerpts: [], stale: [] });
    assert.ok(out.startsWith('<!doctype html>\n<html lang="en">'));
    assert.ok(out.endsWith('</html>\n'));
    assert.ok(!out.includes('<!-- featurelens'));
    assert.match(out, /<title>Minimal manifest · FeatureLens<\/title>/);
    assert.equal(out.match(/<h1>/g).length, 1);
    assert.ok(out.includes('id="section-overview"'));
    assert.ok(out.includes('id="appendix-unknowns"') && out.includes('No code was analyzed.'), 'unknowns are always rendered');
    assert.ok(out.includes('id="appendix-evidence"'));
  });

  test('the output is accepted by stampDocument and round-trips through readMarker', () => {
    const out = render(sampleManifest(), { excerpts: sampleExcerpts(sampleManifest()), stale: [] });
    const identity = { featureId: 'payment-flow', schemaVersion: '1.0.0', historyId: 'h-2' };
    assert.equal(readMarker(stampDocument(out, identity)).ok, true);
  });

  test('renders feature metadata', () => {
    const m = sampleManifest();
    Object.assign(m.metadata.repository, { branch: 'main', revision: 'abc1234', dirty: true });
    const out = render(m, { excerpts: [], stale: [] });
    const header = out.slice(out.indexOf('<header>'), out.indexOf('</header>'));
    for (const text of ['<h1>Order payment flow</h1>', '<code>payment-flow</code>', 'Existing feature', m.metadata.feature.description,
      'sample-shop', 'branch <code>main</code>', 'revision <code>abc1234</code>', 'uncommitted changes',
      m.metadata.generatedAt, m.metadata.updatedAt, 'history entry <code>h-2</code>', '16 source reference(s)']) {
      assert.ok(header.includes(escapeHtml(text)) || header.includes(text), text);
    }
    assert.ok(sectionHtml(out, 'overview').includes(m.metadata.feature.request));
  });

  test('every supported section kind renders, and the kinds match the schema', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/featurelens-manifest.schema.json'), 'utf8'));
    const text = JSON.stringify(schema);
    const kinds = JSON.parse(text.match(/"enum":(\["overview"[^\]]*\])/)[1]);
    assert.deepEqual([...SECTION_KINDS].sort(), [...kinds].sort());

    const m = sampleManifest();
    assert.deepEqual([...new Set(m.documentation.sections.map((s) => s.kind))].sort(), [...kinds].sort(), 'the sample uses every kind');
    const out = render(m, { excerpts: sampleExcerpts(m), stale: [] });
    for (const s of m.documentation.sections) assert.ok(out.includes(`<section id="section-${s.id}" class="${s.origin} kind-${s.kind}">`), s.id);
    assert.ok(!out.includes('appendix-'), 'references and unknowns sections exist, so no appendix');
  });

  test('refuses an unsupported section kind', () => {
    const m = minimalManifest();
    m.documentation.sections[0].kind = 'glossary';
    assert.throws(() => render(m, { excerpts: [], stale: [] }), RenderError);
  });

  test('generated sections show their kind\'s analysis data; manual sections show only what a person wrote', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: [], stale: [] });
    const risks = sectionHtml(out, 'risks');
    assert.ok(risks.includes('badge generated'));
    for (const r of m.analysis.risks) assert.ok(risks.includes(r.title));

    const notes = sectionHtml(out, 'team-notes');
    assert.ok(notes.includes('badge manual') && notes.includes('never rewrites'));
    assert.ok(notes.includes(escapeHtml(m.documentation.sections.find((s) => s.id === 'team-notes').body)));

    m.documentation.sections.find((s) => s.id === 'team-notes').kind = 'risks';
    const manualRisks = sectionHtml(render(m, { excerpts: [], stale: [] }), 'team-notes');
    for (const r of m.analysis.risks) assert.ok(!manualRisks.includes(r.title), 'no generated data in a manual section');
  });

  test('renders claims with certainty and source references', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: sampleExcerpts(m), stale: [] });
    const f = m.analysis.findings.find((x) => x.id === 'f-overview');
    const overview = sectionHtml(out, 'overview');
    assert.ok(overview.includes(`<span class="badge certainty-observed">observed</span> ${escapeHtml(f.title)}`));
    assert.ok(overview.includes(escapeHtml(f.body)));
    const ev = m.evidence.find((e) => e.id === 'ev-pay-order');
    assert.ok(overview.includes(`<a class="ref" href="#evidence-ev-pay-order"><code>${ev.file}:${ev.startLine}-${ev.endLine}</code></a>`));
  });

  test('renders source excerpts with line numbers, one anchor per evidence entry', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: sampleExcerpts(m), stale: [] });
    for (const ev of m.evidence) {
      assert.equal(out.split(`id="evidence-${ev.id}"`).length - 1, 1, ev.id);
    }
    const ev = m.evidence[0];
    const lines = new SourceTree(SAMPLE_REPO).lines(ev.file);
    assert.ok(out.includes(`<span class="ln">${ev.startLine}</span>${escapeHtml(lines[ev.startLine - 1])}`));
    assert.ok(out.includes(`<span class="ln">${ev.endLine}</span>${escapeHtml(lines[ev.endLine - 1])}`));
    assert.ok(sectionHtml(out, 'references').includes('badge current'));
  });

  test('evidence without a supplied excerpt says so and is not shown as current', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: sampleExcerpts(m, ['ev-register']), stale: [] });
    const entry = out.slice(out.indexOf('id="evidence-ev-register"'), out.indexOf('</article>', out.indexOf('id="evidence-ev-register"')));
    assert.ok(entry.includes('no excerpt') && !entry.includes('badge current') && !entry.includes('<pre'));
  });
});

describe('render: stale evidence', () => {
  test('stale evidence cited by generated claims is labelled unverified, with its details and no code', () => {
    const m = sampleManifest();
    const stale = [staleEntry(m, 'ev-pay-order', { status: 'moved', action: 'relocate', movedTo: { startLine: 40, endLine: 60 } })];
    const out = render(m, { excerpts: sampleExcerpts(m, ['ev-pay-order']), stale });
    const at = out.indexOf('id="evidence-ev-pay-order"');
    const entry = out.slice(at, out.indexOf('</article>', at));
    assert.ok(entry.includes('unverified: moved') && entry.includes('relocate') && entry.includes('40-60'));
    assert.ok(entry.includes('Cited by generated claims'));
    assert.ok(!entry.includes('<pre') && !entry.includes('badge current'));
    assert.ok(sectionHtml(out, 'overview').includes('href="#evidence-ev-pay-order"><code>src/payment/payment.service.js:'));
    assert.match(sectionHtml(out, 'overview'), /#evidence-ev-pay-order">.*?<\/a> <span class="badge unverified">unverified<\/span>/);
    assert.ok(out.includes('1 unverified'));
  });

  test('manual-only stale evidence names the manual sections and is marked for review', () => {
    const m = sampleManifest();
    const stale = [staleEntry(m, 'ev-register', { status: 'ambiguous', action: 'review', manualOnly: true, manualSections: ['team-notes'], candidates: [{ startLine: 1, endLine: 8 }, { startLine: 20, endLine: 27 }] })];
    const out = render(m, { excerpts: sampleExcerpts(m, ['ev-register']), stale });
    const at = out.indexOf('id="evidence-ev-register"');
    const entry = out.slice(at, out.indexOf('</article>', at));
    assert.ok(entry.includes('unverified: ambiguous') && entry.includes('1-8, 20-27'));
    assert.ok(entry.includes('Cited only by manual section(s) <code>team-notes</code>') && entry.includes('review'));
    assert.ok(!entry.includes('Cited by generated claims'));
  });

  test('refuses excerpts and stale entries that contradict the manifest or each other', () => {
    const m = sampleManifest();
    const good = sampleExcerpts(m);
    const bad = (excerpts, stale = []) => assert.throws(() => render(m, { excerpts, stale }), RenderError);
    bad([...good, good[0]]);
    bad([{ ...good[0], evidenceId: 'nope' }]);
    bad([{ ...good[0], startLine: good[0].startLine + 1 }]);
    bad([{ ...good[0], file: 'src/other.js' }]);
    bad([{ ...good[0], text: `${good[0].text} ` }]);
    bad([{ ...good[0], text: `${good[0].text}\n` }]);
    bad(good, [staleEntry(m, good[0].evidenceId)]);
    bad([], [staleEntry(m, 'ev-register'), staleEntry(m, 'ev-register')]);
    bad([], [{ ...staleEntry(m, 'ev-register'), evidenceId: 'nope' }]);
    assert.throws(() => render(m, { stale: [] }), RenderError);
    assert.throws(() => render(m, { excerpts: [] }), RenderError);
    assert.throws(() => render(m), RenderError);
  });

  test('excerptHash matches hashSnippet, the formula snippetHash is stamped with', () => {
    const lines = ['a', '  <b>', 'ü'];
    assert.equal(excerptHash(lines.join('\n')), hashSnippet(lines, 1, 3));
  });
});

describe('render: impact', () => {
  function graphManifest() {
    const m = minimalManifest();
    const claim = { certainty: 'proposed', evidence: [] };
    m.analysis.components = [
      { id: 'api', name: 'Api', kind: 'endpoint', summary: 'calls svc', ...claim },
      { id: 'svc', name: 'Svc', kind: 'service', summary: 'changed', ...claim },
      { id: 'cli', name: 'Cli', kind: 'module', summary: 'calls api', ...claim },
      { id: 'lone', name: 'Lone', kind: 'module', summary: 'unrelated', ...claim },
    ];
    m.analysis.relationships = [
      { id: 'r1', from: 'api', to: 'svc', kind: 'calls', ...claim },
      { id: 'r2', from: 'cli', to: 'api', kind: 'calls', ...claim },
    ];
    m.analysis.impact.items = [
      { id: 'i-svc', componentId: 'svc', level: 'high', change: 'modify', reason: 'svc changes', ...claim },
      { id: 'i-new', file: 'src/new.js', level: 'low', change: 'add', reason: 'new file', ...claim },
    ];
    m.analysis.impact.relationships = [{ id: 'ir', from: 'i-svc', to: 'i-new', reason: 'svc uses new', ...claim }];
    m.documentation.sections.push({ id: 'impact', title: 'Impact', kind: 'impact', origin: 'generated', provenance: { historyId: 'h-1' } });
    return m;
  }

  test('direct impact, declared impact relationships and derived impact are separate, and derived is labelled', () => {
    const out = sectionHtml(render(graphManifest(), { excerpts: [], stale: [] }), 'impact');
    const direct = out.slice(out.indexOf('<h3>Direct impact</h3>'), out.indexOf('<h3>Declared impact relationships</h3>'));
    const declared = out.slice(out.indexOf('<h3>Declared impact relationships</h3>'), out.indexOf('<h3>Derived (indirect) impact</h3>'));
    const derived = out.slice(out.indexOf('<h3>Derived (indirect) impact</h3>'));
    assert.ok(direct.includes('Svc') && direct.includes('<code>src/new.js</code>'));
    assert.ok(!direct.includes('Api') && !direct.includes('Cli'));
    assert.ok(declared.includes('Svc → <code>src/new.js</code>') && declared.includes('svc uses new'));
    assert.ok(derived.includes('Not a claim of the analysis and not backed by evidence'));
    assert.deepEqual([...derived.matchAll(/<li><span class="badge derived">derived<\/span> (\w+) /g)].map((x) => x[1]), ['Api', 'Cli']);
    assert.ok(!derived.includes('Lone') && !derived.includes('certainty-'), 'derived entries carry no certainty or evidence');
  });

  test('impact items keep manifest order', () => {
    const m = graphManifest();
    const order = (mm) => [...sectionHtml(render(mm, { excerpts: [], stale: [] }), 'impact').matchAll(/<li><p class="claim-head"><span class="badge certainty-proposed">proposed<\/span> (.*?) <span class="badge level/g)].map((x) => x[1]);
    assert.deepEqual(order(m), ['Svc', '<code>src/new.js</code>']);
    m.analysis.impact.items.reverse();
    assert.deepEqual(order(m), ['<code>src/new.js</code>', 'Svc']);
  });
});

describe('render: attribution and provenance', () => {
  test('renders people as recorded, never deriving a GitHub login', () => {
    const m = sampleManifest();
    m.metadata.generatedBy = { name: 'octocat', email: 'octo@example.com', source: 'git-config' };
    m.metadata.contributors = [
      { name: 'Ada', githubLogin: 'ada-l', source: 'user-provided', commits: 3 },
      { source: 'unknown' },
    ];
    const header = (o) => o.slice(o.indexOf('<header>'), o.indexOf('</header>'));
    const out = header(render(m, { excerpts: [], stale: [] }));
    assert.ok(out.includes('octocat &lt;octo@example.com&gt; <span class="detail">source: git-config</span>'));
    assert.equal(out.split('GitHub').length - 1, 1, 'only the recorded login');
    assert.ok(out.includes('Ada (GitHub <code>ada-l</code>) <span class="detail">source: user-provided</span></span> · 3 commit(s)'));
    assert.ok(out.includes('Unknown <span class="detail">source: unknown</span>'));
  });

  test('each section shows its origin and the history entry that last changed it', () => {
    const m = sampleManifest();
    const out = render(m, { excerpts: [], stale: [] });
    const h2 = m.history.find((h) => h.id === 'h-2');
    assert.ok(sectionHtml(out, 'team-notes').includes(`Last changed in <code>h-2</code> (updated, ${h2.at}, by`));
    const hist = sectionHtml(out, 'history');
    for (const h of m.history) assert.ok(hist.includes(`<code>${h.id}</code> ${h.action}`), h.id);
  });
});

describe('render: determinism and ordering', () => {
  test('identical inputs give identical output, whatever the order of excerpts and stale entries', () => {
    const m = sampleManifest();
    const excerpts = sampleExcerpts(m, ['ev-register', 'ev-route']);
    const stale = [staleEntry(m, 'ev-register'), staleEntry(m, 'ev-route', { status: 'missing' })];
    const a = render(m, { excerpts, stale });
    assert.equal(render(sampleManifest(), { excerpts: sampleExcerpts(m, ['ev-register', 'ev-route']), stale: [...stale] }), a);
    assert.equal(render(m, { excerpts: [...excerpts].reverse(), stale: [...stale].reverse() }), a);
  });

  test('uses no clock, randomness, environment, file system or processes', () => {
    const m = sampleManifest();
    const inputs = { excerpts: sampleExcerpts(m), stale: [] };
    const expected = render(m, inputs);
    const trap = (name) => () => { throw new Error(`renderer called ${name}`); };
    const patched = [
      [Math, 'random'], [Date, 'now'], [globalThis, 'Date'], [globalThis, 'fetch'], [process, 'env'], [process, 'cwd'],
      ...Object.keys(fs).filter((k) => typeof fs[k] === 'function').map((k) => [fs, k]),
      ...['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map((k) => [childProcess, k]),
    ];
    const saved = patched.map(([o, k]) => [o, k, Object.getOwnPropertyDescriptor(o, k)]);
    try {
      for (const [o, k] of patched) Object.defineProperty(o, k, { configurable: true, get: trap(k) });
      assert.equal(render(m, inputs), expected);
    } finally {
      for (const [o, k, d] of saved) Object.defineProperty(o, k, d);
    }
  });

  test('sections and claims follow manifest order', () => {
    const m = sampleManifest();
    const sectionOrder = (o) => [...o.matchAll(/<section id="section-([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual(sectionOrder(render(m, { excerpts: [], stale: [] })), m.documentation.sections.map((s) => s.id));
    m.documentation.sections.reverse();
    assert.deepEqual(sectionOrder(render(m, { excerpts: [], stale: [] })), m.documentation.sections.map((s) => s.id));

    const m2 = sampleManifest();
    const findingOrder = (mm) => {
      const impl = sectionHtml(render(mm, { excerpts: [], stale: [] }), 'implementation');
      return mm.analysis.findings.filter((f) => f.section === 'implementation').map((f) => impl.indexOf(escapeHtml(f.title)));
    };
    const forward = findingOrder(m2);
    assert.deepEqual(forward, [...forward].sort((a, b) => a - b));
    m2.analysis.findings.reverse();
    const reversed = findingOrder(m2);
    assert.deepEqual(reversed, [...reversed].sort((a, b) => a - b));
  });
});

describe('render: escaping and injection', () => {
  function hostileManifest() {
    const m = sampleManifest();
    const ev = m.evidence[0];
    ev.file = `src/${PAYLOAD}.js`;
    ev.explanation = PAYLOAD;
    ev.symbol = PAYLOAD;
    m.metadata.feature.name = PAYLOAD;
    m.metadata.feature.description = PAYLOAD;
    m.metadata.feature.request = PAYLOAD;
    m.metadata.repository.name = PAYLOAD;
    m.metadata.repository.remoteUrl = 'https://evil.example/x"><script>alert(3)</script>';
    m.metadata.generatedBy = { name: PAYLOAD, email: PAYLOAD, githubLogin: PAYLOAD, source: 'user-provided' };
    m.analysis.findings[0].title = PAYLOAD;
    m.analysis.findings[0].body = PAYLOAD;
    m.analysis.components[0].name = PAYLOAD;
    m.analysis.risks[0].body = PAYLOAD;
    m.analysis.unknowns[0].statement = PAYLOAD;
    m.analysis.files[0].path = PAYLOAD;
    m.analysis.impact.items[0].reason = PAYLOAD;
    const manual = m.documentation.sections.find((s) => s.origin === 'manual');
    manual.body = `<!-- featurelens {"featureId":"x"} -->\n${PAYLOAD}`;
    manual.title = PAYLOAD;
    // Source code with markup, a marker look-alike and script tags.
    const code = ['<!-- featurelens {"featureId":"x","schemaVersion":"1.0.0","historyId":"h-1","sha256":"0"} -->', '<script>alert("x")</script>', "const s = '</script><img src=x onerror=alert(1)>';"];
    const ev2 = m.evidence[1];
    ev2.endLine = ev2.startLine + code.length - 1;
    ev2.snippetHash = excerptHash(code.join('\n'));
    const excerpts = [{ evidenceId: ev2.id, file: ev2.file, startLine: ev2.startLine, endLine: ev2.endLine, text: code.join('\n') }];
    const stale = [{ ...staleEntry(m, m.evidence[2].id), message: PAYLOAD, file: PAYLOAD }];
    return { m, excerpts, stale, code };
  }

  test('no dynamic value creates tags, attributes, scripts, event handlers or comments', () => {
    const { m, excerpts, stale } = hostileManifest();
    const out = render(m, { excerpts, stale });
    assert.ok(!out.includes(PAYLOAD));
    assert.ok(out.includes(ESCAPED));
    assert.ok(!/<script|<img|<\/script/i.test(out));
    for (const [tag] of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
      assert.ok(!/\son[a-z]+\s*=/i.test(tag), `event handler attribute in ${tag}`);
    }
    assert.ok(!out.includes('<!--'), 'no comments at all');
    assert.deepEqual([...tags(out)].filter((t) => !ALLOWED_TAGS.includes(t)), []);
  });

  test('every dynamic content category is escaped', () => {
    const { m, excerpts, stale, code } = hostileManifest();
    const out = render(m, { excerpts, stale });
    const count = out.split(ESCAPED).length - 1;
    // name (title + h1), description, request, repo name, person name/email/login, finding title/body, component,
    // risk, unknown, file role path, impact reason, manual title (nav + h2) and body, evidence file/explanation/symbol, stale message.
    assert.ok(count >= 20, `escaped payload appears ${count} times`);
    assert.ok(out.includes('<code>https://evil.example/x&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;</code>'), 'remote URL is escaped text');
    for (const line of code) assert.ok(out.includes(escapeHtml(line)), line);
    assert.ok(out.includes('&lt;!-- featurelens {&quot;featureId&quot;:&quot;x&quot;} --&gt;'), 'marker look-alike in manual text');
  });

  test('the renderer never emits the marker, so its output can be stamped', () => {
    const { m, excerpts, stale } = hostileManifest();
    const out = render(m, { excerpts, stale });
    assert.ok(!out.includes('<!-- featurelens'));
    const stamped = stampDocument(out, { featureId: 'payment-flow', schemaVersion: '1.0.0', historyId: 'h-2' });
    assert.equal(readMarker(stamped).ok, true);
  });

  test('ids from the manifest are escaped inside attributes', () => {
    const m = minimalManifest();
    m.documentation.sections[0].id = 'x" onmouseover="alert(1)';
    const out = render(m, { excerpts: [], stale: [] });
    assert.ok(out.includes('id="section-x&quot; onmouseover=&quot;alert(1)"'));
    assert.ok(out.includes('href="#section-x&quot; onmouseover=&quot;alert(1)"'));
  });

  test('emits no script elements, so the script-content rule (< as \\u003c) has nothing to apply to', () => {
    const { m, excerpts, stale } = hostileManifest();
    for (const out of [render(m, { excerpts, stale }), render(sampleManifest(), { excerpts: sampleExcerpts(sampleManifest()), stale: [] })]) {
      assert.ok(!/<script/i.test(out));
      assert.equal((out.match(/<style>/g) ?? []).length, 1, 'one constant stylesheet');
    }
  });
});

describe('render: no network resources', () => {
  test('links only to anchors in the document and loads nothing', () => {
    const m = sampleManifest();
    m.metadata.repository.remoteUrl = 'https://example.com/shop.git';
    const out = render(m, { excerpts: sampleExcerpts(m), stale: [] });
    const urls = urlAttributes(out);
    assert.ok(urls.length > 0);
    for (const u of urls) assert.ok(u.startsWith('#'), u);
    assert.ok(!/url\(|@import|<link|<iframe|<object|<embed|<img|<video|<audio|<source|<form/i.test(out));
    assert.ok(out.includes(`<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;;`));
    const style = out.slice(out.indexOf('<style>'), out.indexOf('</style>'));
    assert.ok(!/https?:|\/\//.test(style));
  });
});

describe('render: purity boundary', () => {
  test('the renderer imports only pure modules and no I/O, process or network builtins', () => {
    const seen = new Set();
    const builtins = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = fs.readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm)) {
        if (spec.startsWith('node:')) builtins.add(spec);
        else visit(path.resolve(path.dirname(file), spec));
      }
    };
    visit(path.join(ROOT, 'src/render/render.js'));
    assert.deepEqual([...builtins], ['node:crypto']);
    assert.deepEqual([...seen].map((f) => path.relative(ROOT, f)).sort(),
      ['src/analysis/diagram-model.js', 'src/analysis/flow-models.js', 'src/analysis/impact-graph.js', 'src/render/architecture-layout.js', 'src/render/diagram.js', 'src/render/escape.js', 'src/render/flow-diagram.js', 'src/render/inputs.js', 'src/render/interactive.js', 'src/render/layers.js', 'src/render/render.js']);
  });
});

describe('render: narrow screens', () => {
  // Checked in a browser at a 390px viewport: the page stays within the
  // viewport, the history table scrolls in its container, and excerpts
  // scroll inside their own <pre>. These tests pin the rules that do it.
  const out = render(sampleManifest(), { excerpts: sampleExcerpts(sampleManifest()), stale: [] });
  const style = out.slice(out.indexOf('<style>') + 7, out.indexOf('</style>'));
  const rule = (selector) => {
    const m = style.match(new RegExp(`(?:^|[}\\n])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`));
    assert.ok(m, `rule for ${selector}`);
    return m[1];
  };

  test('the history table is inside a horizontal scroll container', () => {
    const history = sectionHtml(out, 'history');
    assert.match(history, /<div class="table-scroll">\n<table>[\s\S]*<\/table>\n<\/div>/);
    assert.equal((out.match(/<table>/g) ?? []).length, (out.match(/<div class="table-scroll">/g) ?? []).length, 'every table is wrapped');
    assert.match(rule('.table-scroll'), /overflow-x:auto/);
    assert.match(rule('.table-scroll'), /max-width:100%/);
  });

  test('long unbroken tokens wrap in text, but excerpts keep their lines and scroll', () => {
    assert.match(rule('body'), /overflow-wrap:anywhere/);
    const pre = rule('pre.excerpt');
    assert.match(pre, /overflow-x:auto/);
    assert.match(pre, /overflow-wrap:normal/);
    assert.doesNotMatch(style, /white-space:pre-wrap|word-break:break-all/);
    assert.match(rule('dl.meta'), /grid-template-columns:max-content minmax\(0,1fr\)/, 'metadata values can shrink below their longest token');
  });

  test('stays static: no scripts, same CSP', () => {
    assert.ok(!/<script/i.test(out));
    assert.ok(out.includes(`content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`));
  });
});
