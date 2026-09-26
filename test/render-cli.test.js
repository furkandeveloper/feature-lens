import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SourceTree, createSourceRef } from '../src/evidence/source.js';
import { readMarker, stampDocument } from '../src/output/marker.js';
import { serializeManifest } from '../src/docs/store.js';
import { recordUpdate } from '../src/manifest/build.js';
import { ROOT, MINIMAL_MANIFEST, sampleManifest, tempDir, sampleRepoCopy } from './helpers.js';

const CLI = path.join(ROOT, 'bin/featurelens.js');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const GATEWAY = 'src/payment/gateway.client.js';

/** What Claude Code hands over: the cited lines of each evidence entry, read with its own tools. */
function collectExcerpts(repo, manifest, skip = []) {
  const tree = new SourceTree(repo);
  return manifest.evidence.filter((e) => !skip.includes(e.id)).map((e) => ({
    evidenceId: e.id, file: e.file, startLine: e.startLine, endLine: e.endLine,
    text: tree.lines(e.file).slice(e.startLine - 1, e.endLine).join('\n'),
  }));
}

/** A repository copy, a manifest file and an excerpt file, ready for `render`. */
function setup(t, { manifest = sampleManifest(), excerpts } = {}) {
  const repo = sampleRepoCopy(t);
  const inputs = tempDir(t);
  const manifestFile = path.join(inputs, 'manifest.json');
  const excerptFile = path.join(inputs, 'excerpts.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(excerptFile, JSON.stringify(excerpts ?? collectExcerpts(repo, manifest)));
  const out = path.join(fs.realpathSync(repo), 'docs/features', manifest.metadata.feature.id);
  return {
    repo, manifest, manifestFile, excerptFile, out,
    render: (...extra) => cli('render', manifestFile, '--repo', repo, '--excerpts', excerptFile, ...extra),
    renderJson: (...extra) => {
      const r = cli('render', manifestFile, '--repo', repo, '--excerpts', excerptFile, '--json', ...extra);
      return { status: r.status, stderr: r.stderr, report: JSON.parse(r.stdout) };
    },
    writeExcerpts: (list) => fs.writeFileSync(excerptFile, typeof list === 'string' ? list : JSON.stringify(list)),
  };
}

function edit(repo, file, change) {
  const abs = path.join(repo, ...file.split('/'));
  fs.writeFileSync(abs, change(fs.readFileSync(abs, 'utf8').split('\n')).join('\n'));
}

/** Change gateway line 12, which ev-gateway and ev-gateway-result (generated claims) cite. */
const changeGatewayLine12 = (repo) => edit(repo, GATEWAY, (lines) => lines.map((l, i) => (i === 11 ? `${l} // changed` : l)));

/** The sample plus ev-manual, cited only by the manual team-notes section, whose lines have moved (review). */
function withManualOnlyStale() {
  const m = sampleManifest();
  const { ref } = createSourceRef(new SourceTree(path.join(ROOT, 'examples/sample-shop')), {
    id: 'ev-manual', file: GATEWAY, startLine: 12, endLine: 12, kind: 'logic', explanation: 'Cited by the team notes.', confidence: 'high',
  });
  ref.startLine = ref.endLine = 13; // the hash is of line 12, so the evidence is stale `moved`
  m.evidence.push(ref);
  m.documentation.sections.find((s) => s.id === 'team-notes').sourceRefs = ['ev-manual'];
  return m;
}

const exists = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0;

describe('render: success', () => {
  test('writes index.html with a valid marker, then manifest.json, and exits 0', (t) => {
    const s = setup(t);
    const r = s.render();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^✓ wrote .*index\.html, .*manifest\.json/);

    const html = fs.readFileSync(path.join(s.out, 'index.html'));
    const reading = readMarker(html);
    assert.equal(reading.ok, true);
    assert.deepEqual({ ...reading.marker, sha256: undefined }, { featureId: 'payment-flow', schemaVersion: '1.0.0', historyId: 'h-2', sha256: undefined });
    assert.equal(fs.readFileSync(path.join(s.out, 'manifest.json'), 'utf8'), serializeManifest(s.manifest));
    assert.match(html.toString(), /<span class="badge current">current<\/span>/);
    assert.doesNotMatch(html.toString(), /no excerpt/);
  });

  test('manifest.json is written last', (t) => {
    const s = setup(t);
    assert.equal(s.render().status, 0);
    const mtime = (f) => fs.statSync(path.join(s.out, f)).mtimeMs;
    assert.ok(mtime('manifest.json') >= mtime('index.html'));
  });

  test('renders the minimal fixture with an empty excerpt list', (t) => {
    const repo = tempDir(t);
    const excerpts = path.join(tempDir(t), 'x.json');
    fs.writeFileSync(excerpts, '[]');
    const r = cli('render', MINIMAL_MANIFEST, '--repo', repo, '--excerpts', excerpts);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(repo, 'docs/features/empty-feature/index.html')));
  });

  test('--json reports validation, gate, excerpts and the files written', (t) => {
    const s = setup(t);
    const { status, report } = s.renderJson();
    assert.equal(status, 0);
    assert.equal(report.exitCode, 0);
    assert.equal(report.written, true);
    assert.equal(report.validation.valid, true);
    assert.equal(report.validation.evidenceChecked, true);
    assert.deepEqual(report.gate, { ok: true, reasons: [] });
    assert.deepEqual(report.excerpts, { supplied: s.manifest.evidence.length, missing: [] });
    assert.deepEqual(report.output.written.map((f) => path.basename(f)), ['index.html', 'manifest.json']);
    assert.equal(report.existing.code, 'absent');
  });

  test('writes to the outputDir from .featurelens.json', (t) => {
    const s = setup(t);
    fs.writeFileSync(path.join(s.repo, '.featurelens.json'), JSON.stringify({ outputDir: 'docs/lens' }));
    assert.equal(s.render().status, 0);
    assert.ok(fs.existsSync(path.join(s.repo, 'docs/lens/payment-flow/index.html')));
  });
});

describe('render: usage', () => {
  test('usage errors exit 2 and write nothing', (t) => {
    const s = setup(t);
    assert.equal(cli('render').status, 2);
    assert.equal(cli('render', s.manifestFile, '--excerpts', s.excerptFile).status, 2, 'no --repo');
    assert.equal(cli('render', s.manifestFile, '--repo', s.repo).status, 2, 'no --excerpts');
    assert.equal(cli('render', s.manifestFile, '--repo', path.join(s.repo, 'nope'), '--excerpts', s.excerptFile).status, 2);
    assert.equal(s.render('--force').status, 2, 'there is no --force flag');
    assert.equal(s.render('--acknowledge').status, 2, '--acknowledge needs an id');
    assert.equal(exists(path.join(s.repo, 'docs')), false);
  });
});

describe('render: manifest and validation', () => {
  test('a missing or malformed manifest exits 1', (t) => {
    const s = setup(t);
    assert.equal(cli('render', path.join(s.repo, 'missing.json'), '--repo', s.repo, '--excerpts', s.excerptFile).status, 1);
    fs.writeFileSync(s.manifestFile, '{ nope');
    assert.equal(s.render().status, 1);
    assert.equal(exists(path.join(s.repo, 'docs')), false);
  });

  test('an invalid manifest exits 1, reports the errors and writes nothing', (t) => {
    const m = sampleManifest();
    m.analysis.findings[0].section = 'nowhere';
    const s = setup(t, { manifest: m });
    const r = s.render();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /error {3}\[section\.unknown\]/);
    assert.match(r.stdout, /not written/);
    assert.equal(exists(s.out), false);
  });

  test('evidence is always checked against the repository before the gate', (t) => {
    const s = setup(t);
    const { report } = s.renderJson();
    assert.equal(report.validation.evidenceChecked, true, 'render requires --repo, so evidence can never be unchecked');
  });
});

describe('render: excerpt input', () => {
  test('a missing or malformed excerpt file exits 1 and writes nothing', (t) => {
    const s = setup(t);
    const one = collectExcerpts(s.repo, s.manifest).slice(0, 1);
    for (const [label, content] of [
      ['not JSON', '[{'],
      ['not an array', '{"excerpts":[]}'],
      ['extra key', [{ ...one[0], symbol: 'x' }]],
      ['missing key', [{ ...one[0], text: undefined }]],
      ['wrong type', [{ ...one[0], startLine: '3' }]],
    ]) {
      s.writeExcerpts(content);
      const r = s.renderJson();
      assert.equal(r.status, 1, label);
      assert.equal(r.report.refused.step, 'excerpts', label);
    }
    fs.rmSync(s.excerptFile);
    assert.equal(s.render().status, 1, 'excerpt file does not exist');
    assert.equal(exists(s.out), false);
  });

  test('refuses excerpts that do not match the manifest: hash, unknown id, duplicate, location', (t) => {
    const s = setup(t);
    const good = collectExcerpts(s.repo, s.manifest);
    const cases = {
      hash: [{ ...good[0], text: `${good[0].text} ` }, ...good.slice(1)],
      unknown: [...good, { ...good[0], evidenceId: 'ev-nope' }],
      duplicate: [...good, good[0]],
      location: [{ ...good[0], startLine: good[0].startLine + 1, endLine: good[0].endLine + 1 }, ...good.slice(1)],
    };
    for (const [label, list] of Object.entries(cases)) {
      s.writeExcerpts(list);
      const r = s.renderJson();
      assert.equal(r.status, 1, label);
      assert.equal(r.report.refused.step, 'excerpts', label);
      assert.equal(r.report.written, false, label);
    }
    assert.equal(exists(s.out), false);
  });

  test('excerpt order does not affect the output', (t) => {
    const s = setup(t);
    assert.equal(s.render().status, 0);
    const first = fs.readFileSync(path.join(s.out, 'index.html'));
    s.writeExcerpts(collectExcerpts(s.repo, s.manifest).reverse());
    assert.equal(s.render().status, 0);
    assert.deepEqual(fs.readFileSync(path.join(s.out, 'index.html')), first);
  });

  test('never reads source files to fill in excerpts that were not supplied', (t) => {
    const s = setup(t);
    s.writeExcerpts(collectExcerpts(s.repo, s.manifest, ['ev-pay-order']));
    const r = s.renderJson();
    assert.equal(r.status, 0);
    assert.deepEqual(r.report.excerpts.missing, ['ev-pay-order']);
    const html = fs.readFileSync(path.join(s.out, 'index.html'), 'utf8');
    const entry = html.slice(html.indexOf('id="evidence-ev-pay-order"'), html.indexOf('</article>', html.indexOf('id="evidence-ev-pay-order"')));
    assert.match(entry, /no excerpt/);
    assert.doesNotMatch(entry, /<pre/);
  });

  test('the CLI has no source reading or repository inspection of its own', () => {
    // Cited lines are read only by validation (through SourceTree); excerpts come from the --excerpts file.
    const bin = fs.readFileSync(CLI, 'utf8');
    for (const name of ['evidence/source.js', 'SourceTree', 'readdirSync', 'opendirSync', 'glob']) {
      assert.ok(!bin.includes(name), `bin mentions ${name}`);
    }
  });
});

describe('render: stale evidence and the write gate', () => {
  test('stale evidence cited by generated claims is refused with exit 3, even when acknowledged', (t) => {
    const s = setup(t);
    changeGatewayLine12(s.repo);
    for (const extra of [[], ['--acknowledge', 'ev-gateway', '--acknowledge', 'ev-gateway-result']]) {
      const r = s.render(...extra);
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, /stale {3}\[changed → reanalyze\]/);
      assert.match(r.stderr, /refused \[write-gate\] evidence "ev-gateway-result" is changed/);
      assert.match(r.stdout, /not written/);
    }
    assert.match(s.render('--acknowledge', 'ev-gateway').stderr, /--acknowledge ev-gateway has no effect/);
    assert.equal(exists(s.out), false);
  });

  test('excerpts collected before the code changed: stale is reported first (exit 3)', (t) => {
    const s = setup(t);
    changeGatewayLine12(s.repo); // the excerpt file still has the old lines, which match snippetHash
    const r = s.renderJson();
    assert.equal(r.status, 3);
    assert.equal(r.report.refused.step, 'write-gate');
    assert.equal(exists(s.out), false);
  });

  test('an excerpt for stale evidence is refused, even when it hashes to the stamped snippetHash', (t) => {
    const m = withManualOnlyStale();
    const s = setup(t, { manifest: m });
    const line12 = new SourceTree(s.repo).lines(GATEWAY)[11];
    s.writeExcerpts([
      ...collectExcerpts(s.repo, m, ['ev-manual']),
      { evidenceId: 'ev-manual', file: GATEWAY, startLine: 13, endLine: 13, text: line12 },
    ]);
    const r = s.renderJson('--acknowledge', 'ev-manual');
    assert.equal(r.status, 1);
    assert.equal(r.report.refused.step, 'excerpts');
    assert.match(r.report.refused.message, /stale evidence "ev-manual"/);
    assert.equal(exists(s.out), false);
  });

  test('manual-only stale evidence is refused unless acknowledged, then written as unverified with exit 3', (t) => {
    const m = withManualOnlyStale();
    const s = setup(t, { manifest: m });
    s.writeExcerpts(collectExcerpts(s.repo, m, ['ev-manual']));

    const refused = s.renderJson();
    assert.equal(refused.status, 3);
    assert.equal(refused.report.written, false);
    assert.equal(refused.report.refused.step, 'write-gate');
    assert.match(refused.report.gate.reasons[0], /only manual sections cite it/);
    assert.equal(exists(s.out), false);

    const written = s.renderJson('--acknowledge', 'ev-manual');
    assert.equal(written.status, 3, 'the document is still stale');
    assert.equal(written.report.written, true);
    const html = fs.readFileSync(path.join(s.out, 'index.html'), 'utf8');
    const entry = html.slice(html.indexOf('id="evidence-ev-manual"'), html.indexOf('</article>', html.indexOf('id="evidence-ev-manual"')));
    assert.match(entry, /unverified: moved/);
    assert.doesNotMatch(entry, /<pre/);
    assert.match(s.render('--acknowledge', 'ev-manual').stdout, /^! wrote .*acknowledged manual-only/);
  });

  test('mixed stale evidence is refused when only the manual-only entry is acknowledged', (t) => {
    const m = withManualOnlyStale();
    const s = setup(t, { manifest: m });
    changeGatewayLine12(s.repo);
    s.writeExcerpts(collectExcerpts(s.repo, m, ['ev-manual', 'ev-gateway', 'ev-gateway-result']));
    const r = s.renderJson('--acknowledge', 'ev-manual');
    assert.equal(r.status, 3);
    assert.equal(r.report.written, false);
    assert.deepEqual(r.report.gate.reasons.map((x) => x.match(/"([^"]+)"/)[1]), ['ev-gateway', 'ev-gateway-result']);
    assert.equal(exists(s.out), false);
  });
});

describe('render: existing output', () => {
  const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

  test('re-rendering intact output regenerates it', (t) => {
    const s = setup(t);
    assert.equal(s.render().status, 0);
    const { status, report } = s.renderJson();
    assert.equal(status, 0);
    assert.equal(report.existing.code, 'in-sync');
  });

  test('a hand-edited index.html is refused with exit 1 and left untouched', (t) => {
    const s = setup(t);
    assert.equal(s.render().status, 0);
    fs.appendFileSync(path.join(s.out, 'index.html'), '<p>my notes</p>\n');
    const before = snapshot(s.out);
    const { status, report } = s.renderJson();
    assert.equal(status, 1);
    assert.equal(report.refused.step, 'existing-output');
    assert.equal(report.refused.code, 'hash-mismatch');
    assert.deepEqual(snapshot(s.out), before);
  });

  test('HTML without a marker is refused', (t) => {
    const s = setup(t);
    fs.mkdirSync(s.out, { recursive: true });
    fs.writeFileSync(path.join(s.out, 'index.html'), '<!doctype html>\n<p>hand written</p>\n');
    fs.writeFileSync(path.join(s.out, 'manifest.json'), serializeManifest(s.manifest));
    assert.equal(s.renderJson().report.refused.code, 'marker-missing');
  });

  test('a folder that belongs to another feature is refused', (t) => {
    const s = setup(t);
    const other = sampleManifest();
    other.metadata.feature.id = 'other-feature';
    fs.mkdirSync(s.out, { recursive: true });
    fs.writeFileSync(path.join(s.out, 'manifest.json'), serializeManifest(other));
    const { status, report } = s.renderJson();
    assert.equal(status, 1);
    assert.equal(report.refused.code, 'feature-id-mismatch');
  });

  test('HTML stamped with another schema version is refused', (t) => {
    const s = setup(t);
    assert.equal(s.render().status, 0);
    const file = path.join(s.out, 'index.html');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const unmarked = [lines[0], ...lines.slice(2)].join('\n');
    fs.writeFileSync(file, stampDocument(unmarked, { featureId: 'payment-flow', schemaVersion: '1.0.1', historyId: 'h-2' }));
    const { status, report } = s.renderJson();
    assert.equal(status, 1);
    assert.equal(report.refused.code, 'schema-version-mismatch');
  });

  test('an interrupted write (HTML ahead of manifest.json) is regenerated and reported', (t) => {
    const s = setup(t);
    assert.equal(s.render().status, 0);
    const behind = structuredClone(s.manifest);
    behind.history = behind.history.slice(0, 1);
    fs.writeFileSync(path.join(s.out, 'manifest.json'), serializeManifest(behind));

    const r = s.render();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /note {4}existing index\.html was generated at history "h-2" but manifest\.json is at "h-1"/);
    assert.equal(fs.readFileSync(path.join(s.out, 'manifest.json'), 'utf8'), serializeManifest(s.manifest));
    assert.equal(readMarker(fs.readFileSync(path.join(s.out, 'index.html'))).marker.historyId, 'h-2');
  });

  test('a manifest whose history does not extend the existing one is refused as history-regression', (t) => {
    const s = setup(t);
    const { manifest: newer } = recordUpdate(s.manifest, { by: { source: 'unknown' }, summary: 'Newer.', changedSections: ['overview'], repoRoot: s.repo });
    fs.writeFileSync(s.manifestFile, JSON.stringify(newer));
    assert.equal(s.render().status, 0);
    const before = [fs.readFileSync(path.join(s.out, 'index.html')), fs.readFileSync(path.join(s.out, 'manifest.json'))];

    fs.writeFileSync(s.manifestFile, JSON.stringify(s.manifest));
    const { status, report } = s.renderJson();
    assert.equal(status, 1);
    assert.deepEqual([report.written, report.refused.step, report.refused.code], [false, 'existing-output', 'history-regression']);
    assert.deepEqual(report.existing.historyRegression, {
      reason: 'older', existingLength: 3, incomingLength: 2, existingHistoryId: 'h-3', incomingHistoryId: 'h-2',
    });
    assert.deepEqual([fs.readFileSync(path.join(s.out, 'index.html')), fs.readFileSync(path.join(s.out, 'manifest.json'))], before);
  });

  test('an output directory that escapes the repository is refused', (t) => {
    const s = setup(t);
    fs.symlinkSync(tempDir(t), path.join(s.repo, 'docs'));
    const { status, report } = s.renderJson();
    assert.equal(status, 1);
    assert.equal(report.refused.step, 'output');
    assert.match(report.refused.message, /outside the repository/);
  });
});
