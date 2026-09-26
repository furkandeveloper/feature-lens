import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from '../src/validation/validate.js';
import { SourceTree, createSourceRef, hashSnippet, EvidenceError } from '../src/evidence/source.js';
import { SAMPLE_REPO, sampleManifest, issues, tempDir, sampleRepoCopy } from './helpers.js';

const run = (m, repoRoot = SAMPLE_REPO) => {
  const r = validateManifest(m, { repoRoot });
  return { errors: issues(r.errors), warnings: issues(r.warnings) };
};

describe('evidence against the repository', () => {
  test('without repoRoot, files are not checked and the result says so', () => {
    const m = sampleManifest();
    m.evidence[0].file = 'src/invented.js';
    const r = validateManifest(m);
    assert.equal(r.valid, true);
    assert.equal(r.evidenceChecked, false);
  });

  test('a listed file that no evidence covers and that does not exist is an error', () => {
    const m = sampleManifest();
    m.analysis.files.push({ path: 'src/payment/refund.service.js', role: 'supporting', reason: 'invented' });
    const r = validateManifest(m, { repoRoot: SAMPLE_REPO });
    assert.deepEqual(issues(r.errors), ['file.missing /analysis/files/5/path']);
    assert.match(r.errors[0].message, /file not found/);
    assert.deepEqual(r.stale, []);
  });

  test('a reversed line range is an error; a range past the end of the file is stale', () => {
    const m = sampleManifest();
    m.evidence[0].endLine = 500;
    m.evidence[1].startLine = 4;
    m.evidence[1].endLine = 3;
    const r = validateManifest(m, { repoRoot: SAMPLE_REPO });
    assert.deepEqual(issues(r.errors), ['evidence.range /evidence/1/endLine']);
    assert.deepEqual(r.stale.map((s) => `${s.status} ${s.path}`), ['changed /evidence/0']);
  });

  test('warns when a cited symbol is not in the cited range', () => {
    const m = sampleManifest();
    m.evidence[4].symbol = 'refundOrder';
    assert.deepEqual(run(m), { errors: [], warnings: ['evidence.symbol /evidence/4/symbol'] });
  });

  test('detects cited code that changed since it was cited', (t) => {
    const repo = sampleRepoCopy(t);
    const file = path.join(repo, 'src/payment/payment.service.js');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines[25] = "    if (!charge.succeeded) return { ok: false, error: 'DECLINED' };"; // line 26
    fs.writeFileSync(file, lines.join('\n'));

    // ev-pay-order (8-30) and ev-declined (26) cover line 26; nothing else does.
    const r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.stale.map((s) => `${s.status} ${s.evidenceId}`), ['changed ev-pay-order', 'changed ev-declined']);
  });

  test('line endings do not affect snippet hashes', (t) => {
    const repo = sampleRepoCopy(t);
    const file = path.join(repo, 'src/payment/payment.service.js');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    assert.deepEqual(run(sampleManifest(), repo).errors, []);
  });

  test('rejects paths that are absolute, not normalized, or escape the repository', () => {
    for (const file of ['/etc/passwd', '../package.json', './src/payment/payment.service.js', 'src//payment.js', 'src\\payment\\x.js', 'C:/x.js']) {
      const m = sampleManifest();
      m.evidence[0].file = file;
      assert.deepEqual(run(m).errors, ['schema.pattern /evidence/0/file'], file);
    }
    const m = sampleManifest();
    m.evidence[0].file = 'src/payment';
    const r = validateManifest(m, { repoRoot: SAMPLE_REPO });
    assert.deepEqual(issues(r.errors), []);
    assert.deepEqual(r.stale.map((s) => `${s.status} ${s.path}`), ['missing /evidence/0'], 'a directory is not a regular file');
  });

  test('rejects symlinks that point outside the repository', (t) => {
    const repo = sampleRepoCopy(t);
    const outside = tempDir(t);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x\n'.repeat(20));
    const link = path.join(repo, 'src/payment/payment.repository.js');
    fs.rmSync(link);
    fs.symlinkSync(path.join(outside, 'secret.txt'), link);

    const r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.deepEqual(issues(r.errors), ['evidence.file /evidence/13/file', 'file.missing /analysis/files/3/path']);
    assert.match(r.errors[0].message, /outside the repository/);
    assert.deepEqual(r.stale, [], 'a path escaping the repository is a safety error, never staleness');
  });

  test('impact items: files to modify must exist, files to add should not', () => {
    const m = sampleManifest();
    m.analysis.impact.items[3].file = 'src/payment/payment.service.js';     // change: add
    m.analysis.impact.items[0].file = 'src/payment/refund.service.js';      // change: review
    assert.deepEqual(run(m), {
      errors: ['file.missing /analysis/impact/items/0/file'],
      warnings: ['impact.file-exists /analysis/impact/items/3/file'],
    });
  });

  test('internal evidence warnings: uncited, unlisted file, older revision', () => {
    const m = sampleManifest();
    m.evidence.push({ id: 'ev-unused', file: 'README.md', startLine: 1, endLine: 1, kind: 'documentation', explanation: 'x', confidence: 'low', snippetHash: `sha256:${'0'.repeat(64)}` });
    m.metadata.repository.revision = 'bbbbbbb';
    m.history[1].revision = 'bbbbbbb';
    m.evidence[0].revision = 'aaaaaaa';
    const r = validateManifest(m);
    assert.deepEqual(issues(r.errors), []);
    assert.deepEqual(issues(r.warnings), [
      'evidence.revision /evidence/0/revision',
      'evidence.uncited /evidence/16',
      'evidence.unlisted-file /evidence/16/file',
    ]);
  });
});

describe('createSourceRef', () => {
  const tree = new SourceTree(SAMPLE_REPO);
  const base = { id: 'ev-x', kind: 'definition', explanation: 'test', confidence: 'high' };

  test('builds a reference with the hash of the real lines', () => {
    const { ref, warnings } = createSourceRef(tree, { ...base, file: 'src/payment/payment.service.js', startLine: 8, endLine: 30, symbol: 'payOrder' });
    assert.deepEqual(warnings, []);
    const lines = tree.lines('src/payment/payment.service.js');
    assert.equal(ref.snippetHash, hashSnippet(lines, 8, 30));
    assert.equal(ref.snippetHash, sampleManifest().evidence[4].snippetHash);
  });

  test('refuses locations that do not exist', () => {
    const cases = [
      { file: 'src/payment/refund.service.js', startLine: 1, endLine: 2 },
      { file: 'src/payment/payment.service.js', startLine: 30, endLine: 40 },
      { file: 'src/payment/payment.service.js', startLine: 5, endLine: 4 },
      { file: 'src/payment/payment.service.js', startLine: 0, endLine: 1 },
      { file: '../package.json', startLine: 1, endLine: 1 },
    ];
    for (const c of cases) assert.throws(() => createSourceRef(tree, { ...base, ...c }), EvidenceError, JSON.stringify(c));
  });

  test('warns, but does not refuse, when the symbol is not in range', () => {
    const { warnings } = createSourceRef(tree, { ...base, file: 'src/payment/payment.service.js', startLine: 1, endLine: 3, symbol: 'payOrder' });
    assert.equal(warnings.length, 1);
  });
});
