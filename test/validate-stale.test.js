import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateManifest } from '../src/validation/validate.js';
import { checkWriteGate } from '../src/validation/gate.js';
import { SourceTree, createSourceRef } from '../src/evidence/source.js';
import { ROOT, SAMPLE_REPO, SAMPLE_MANIFEST, sampleManifest, minimalManifest, issues, tempDir, sampleRepoCopy } from './helpers.js';

const SERVICE = 'src/payment/payment.service.js';
const GATEWAY = 'src/payment/gateway.client.js';

/** Rewrite a file in a repository copy through a function of its lines. */
function edit(repo, file, change) {
  const abs = path.join(repo, ...file.split('/'));
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  fs.writeFileSync(abs, change(lines).join('\n'));
}

const byId = (result) => Object.fromEntries(result.stale.map((s) => [s.evidenceId, s]));

/** The sample manifest plus evidence on gateway line 12 that only the manual section cites. */
function withManualEvidence() {
  const m = sampleManifest();
  const { ref } = createSourceRef(new SourceTree(SAMPLE_REPO), {
    id: 'ev-manual', file: GATEWAY, startLine: 12, endLine: 12, kind: 'logic', explanation: 'Cited by the team notes.', confidence: 'high',
  });
  m.evidence.push(ref);
  const notes = m.documentation.sections.find((s) => s.id === 'team-notes');
  notes.sourceRefs = ['ev-manual', 'ev-gateway-result'];
  return m;
}

describe('stale evidence', () => {
  test('current: evidence that still matches produces no stale entries', () => {
    const r = validateManifest(sampleManifest(), { repoRoot: SAMPLE_REPO });
    assert.equal(r.valid, true);
    assert.deepEqual(r.stale, []);
  });

  test('without repoRoot, nothing is checked and nothing is stale', () => {
    const r = validateManifest(sampleManifest());
    assert.equal(r.evidenceChecked, false);
    assert.deepEqual(r.stale, []);
  });

  test('moved: identical lines found at exactly one other place', (t) => {
    const repo = sampleRepoCopy(t);
    edit(repo, SERVICE, (lines) => ['// header', '', ...lines]);

    const r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.stale.map((s) => s.evidenceId), [
      'ev-service-ctor', 'ev-pay-order', 'ev-order-guards', 'ev-charge-call', 'ev-payment-insert', 'ev-declined', 'ev-mark-paid',
    ]);
    const payOrder = byId(r)['ev-pay-order'];
    assert.equal(payOrder.status, 'moved');
    assert.equal(payOrder.action, 'relocate');
    assert.deepEqual(payOrder.movedTo, { startLine: 10, endLine: 32 });
    assert.equal(payOrder.path, '/evidence/4');
    assert.equal(payOrder.file, SERVICE);
    assert.ok(payOrder.claims.length > 0);
    assert.ok(payOrder.claims.includes('/documentation/sections/0'), 'the overview cites it through sourceRefs');
    assert.equal(payOrder.manualOnly, false);
    assert.equal(r.stale.every((s) => s.status === 'moved'), true);
  });

  test('changed: the cited lines exist nowhere in the file', (t) => {
    const repo = sampleRepoCopy(t);
    edit(repo, SERVICE, (lines) => lines.map((l, i) => (i === 25 ? "    if (!charge.succeeded) return { ok: false, error: 'DECLINED' };" : l)));

    const declined = byId(validateManifest(sampleManifest(), { repoRoot: repo }))['ev-declined'];
    assert.equal(declined.status, 'changed');
    assert.equal(declined.action, 'reanalyze');
    assert.equal(declined.movedTo, undefined);
    assert.ok(declined.claims.every((p) => p.startsWith('/')), 'claims are JSON Pointers');
    assert.ok(declined.claims.length > 0);
  });

  test('missing: the cited file was deleted; listed files it covers are not errors', (t) => {
    const repo = sampleRepoCopy(t);
    fs.rmSync(path.join(repo, GATEWAY));

    const r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.equal(r.valid, true);
    assert.deepEqual(issues(r.errors), []);
    assert.deepEqual(r.stale.map((s) => `${s.status} ${s.action} ${s.evidenceId}`), [
      'missing reanalyze ev-gateway', 'missing reanalyze ev-gateway-url', 'missing reanalyze ev-gateway-result',
    ]);
    assert.ok(byId(r)['ev-gateway'].claims.includes('/analysis/files/2'));
  });

  test('ambiguous: the cited lines appear more than once, so nothing is moved', (t) => {
    const repo = sampleRepoCopy(t);
    // Shift everything by one line, then repeat line 26 at the end.
    edit(repo, SERVICE, (lines) => ['// header', ...lines.slice(0, 31), lines[25]]);

    const declined = byId(validateManifest(sampleManifest(), { repoRoot: repo }))['ev-declined'];
    assert.equal(declined.status, 'ambiguous');
    assert.equal(declined.action, 'review');
    assert.equal(declined.movedTo, undefined);
    assert.deepEqual(declined.candidates, [{ startLine: 27, endLine: 27 }, { startLine: 33, endLine: 33 }]);
  });

  test('manual sections: evidence only they cite is marked manualOnly and needs review', (t) => {
    const repo = sampleRepoCopy(t);
    edit(repo, GATEWAY, (lines) => lines.map((l, i) => (i === 11 ? `${l} // changed` : l)));

    const r = validateManifest(withManualEvidence(), { repoRoot: repo });
    assert.equal(r.valid, true);
    const stale = byId(r);
    assert.deepEqual(Object.keys(stale).sort(), ['ev-gateway', 'ev-gateway-result', 'ev-manual']);

    assert.equal(stale['ev-manual'].manualOnly, true);
    assert.equal(stale['ev-manual'].action, 'review');
    assert.deepEqual(stale['ev-manual'].manualSections, ['team-notes']);
    assert.deepEqual(stale['ev-manual'].claims, ['/documentation/sections/10']);

    // Cited by the manual section and by generated claims: not manual-only.
    assert.equal(stale['ev-gateway-result'].manualOnly, false);
    assert.equal(stale['ev-gateway-result'].action, 'reanalyze');
    assert.deepEqual(stale['ev-gateway-result'].manualSections, ['team-notes']);

    assert.deepEqual(stale['ev-gateway'].manualSections, []);
  });

  test('a generated finding placed in a manual section is not manual use', (t) => {
    const repo = sampleRepoCopy(t);
    const m = withManualEvidence();
    m.documentation.sections.find((s) => s.id === 'team-notes').sourceRefs = [];
    m.analysis.findings.push({ id: 'f-in-notes', section: 'team-notes', title: 't', body: 'b', certainty: 'observed', evidence: ['ev-manual'] });
    edit(repo, GATEWAY, (lines) => lines.map((l, i) => (i === 11 ? `${l} // changed` : l)));

    const r = validateManifest(m, { repoRoot: repo });
    const manual = byId(r)['ev-manual'];
    assert.equal(manual.manualOnly, false);
    assert.equal(manual.action, 'reanalyze');
    assert.deepEqual(manual.manualSections, []);
    const onlyThis = { ...r, stale: [manual] };
    assert.equal(checkWriteGate(onlyThis, { acknowledged: ['ev-manual'] }).ok, false, 'a generated claim cannot keep stale evidence');
  });

  test('missing covers dangling symlinks and non-regular files; nothing is read', (t) => {
    const repo = sampleRepoCopy(t);
    const file = path.join(repo, GATEWAY);
    fs.rmSync(file);
    fs.symlinkSync('/nonexistent/outside.js', file);
    let r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.stale.map((s) => s.status), ['missing', 'missing', 'missing']);

    fs.rmSync(file);
    fs.mkdirSync(file);
    r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.deepEqual(r.stale.map((s) => s.status), ['missing', 'missing', 'missing']);
  });

  test('an unreadable file is an error, not stale, and does not crash validation', (t) => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('permissions are not enforced');
    const repo = sampleRepoCopy(t);
    const file = path.join(repo, GATEWAY);
    fs.chmodSync(file, 0o000); // the temp directory stays writable, so cleanup still works

    const r = validateManifest(sampleManifest(), { repoRoot: repo });
    assert.equal(r.valid, false);
    assert.deepEqual(issues(r.errors), ['evidence.file /evidence/10/file', 'evidence.file /evidence/11/file', 'evidence.file /evidence/12/file']);
    assert.match(r.errors[0].message, /cannot read/);
    assert.deepEqual(r.stale, []);
  });

  test('invalid and stale are reported separately; invalid wins', (t) => {
    const repo = sampleRepoCopy(t);
    fs.rmSync(path.join(repo, GATEWAY));
    const m = sampleManifest();
    m.analysis.findings[0].section = 'nowhere';

    const r = validateManifest(m, { repoRoot: repo });
    assert.equal(r.valid, false);
    assert.deepEqual(issues(r.errors), ['section.unknown /analysis/findings/0/section']);
    assert.equal(r.stale.length, 3);
  });
});

describe('schema 1.0.0 corrections', () => {
  test('snippetHash is required on every evidence entry', () => {
    const m = sampleManifest();
    delete m.evidence[2].snippetHash;
    assert.deepEqual(issues(validateManifest(m).errors), ['schema.required /evidence/2']);
  });

  test('provenance.contentHash is no longer part of the schema', () => {
    const m = minimalManifest();
    m.documentation.sections[0].provenance.contentHash = `sha256:${'0'.repeat(64)}`;
    assert.deepEqual(issues(validateManifest(m).errors), ['schema.additionalProperties /documentation/sections/0/provenance/contentHash']);
  });
});

describe('checkWriteGate', () => {
  const current = () => validateManifest(sampleManifest(), { repoRoot: SAMPLE_REPO });

  test('allows a valid, checked, current manifest', () => {
    assert.deepEqual(checkWriteGate(current()), { ok: true, reasons: [], blocking: [] });
  });

  test('refuses invalid manifests and unchecked evidence', () => {
    const m = sampleManifest();
    m.analysis.findings[0].section = 'nowhere';
    assert.equal(checkWriteGate(validateManifest(m, { repoRoot: SAMPLE_REPO })).ok, false);

    const unchecked = checkWriteGate(validateManifest(sampleManifest()));
    assert.equal(unchecked.ok, false);
    assert.match(unchecked.reasons.join('\n'), /not checked/);
  });

  test('refuses stale evidence; only manual-only entries can be acknowledged', (t) => {
    const repo = sampleRepoCopy(t);
    edit(repo, GATEWAY, (lines) => lines.map((l, i) => (i === 11 ? `${l} // changed` : l)));
    const r = validateManifest(withManualEvidence(), { repoRoot: repo });

    const refused = checkWriteGate(r);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.blocking.map((s) => s.evidenceId), ['ev-gateway', 'ev-gateway-result', 'ev-manual']);

    const acknowledged = checkWriteGate(r, { acknowledged: ['ev-manual', 'ev-gateway'] });
    assert.deepEqual(acknowledged.blocking.map((s) => s.evidenceId), ['ev-gateway', 'ev-gateway-result'],
      'ev-gateway is cited by generated claims, so acknowledging it does nothing');

    const repoWithOnlyManualStale = sampleRepoCopy(t);
    const m = withManualEvidence();
    m.documentation.sections.find((s) => s.id === 'team-notes').sourceRefs = ['ev-manual'];
    m.evidence.at(-1).startLine = m.evidence.at(-1).endLine = 13; // hash is of line 12, now at another place
    const onlyManual = validateManifest(m, { repoRoot: repoWithOnlyManualStale });
    assert.deepEqual(onlyManual.stale.map((s) => `${s.status} ${s.action}`), ['moved review']);
    assert.equal(checkWriteGate(onlyManual).ok, false);
    assert.equal(checkWriteGate(onlyManual, { acknowledged: ['ev-manual'] }).ok, true);
  });
});

describe('validate CLI exit codes', () => {
  const CLI = path.join(ROOT, 'bin/featurelens.js');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  test('exits 3 for a valid but stale document and lists the stale evidence', (t) => {
    const repo = sampleRepoCopy(t);
    edit(repo, SERVICE, (lines) => ['// header', ...lines]);

    const text = cli('validate', SAMPLE_MANIFEST, '--repo', repo);
    assert.equal(text.status, 3, text.stderr);
    assert.match(text.stdout, /valid but stale: 7 evidence/);
    assert.match(text.stderr, /stale {3}\[moved → relocate\] \/evidence\/4 ev-pay-order: .* moved to lines 9-31/);

    const json = cli('validate', SAMPLE_MANIFEST, '--repo', repo, '--json');
    assert.equal(json.status, 3);
    const result = JSON.parse(json.stdout);
    assert.equal(result.valid, true);
    assert.equal(result.stale.length, 7);
  });

  test('exits 1, not 3, when a stale document is also invalid', (t) => {
    const repo = sampleRepoCopy(t);
    edit(repo, SERVICE, (lines) => ['// header', ...lines]);
    const m = sampleManifest();
    m.analysis.findings[0].section = 'nowhere';
    const file = path.join(tempDir(t), 'm.json');
    fs.writeFileSync(file, JSON.stringify(m));

    const r = cli('validate', file, '--repo', repo, '--json');
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).stale.length, 7);
  });
});
