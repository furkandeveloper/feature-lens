// The build/update workflow end to end, through the real CLI: draft → build
// → render, then code changes → validate → revised copy → update → render.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { buildFromDraft, planUpdate, WorkflowError } from '../src/manifest/workflow.js';
import { recordUpdate, sectionsCitingEvidence } from '../src/manifest/build.js';
import { validateManifest } from '../src/validation/validate.js';
import { serializeManifest } from '../src/docs/store.js';
import { ROOT, SAMPLE_REPO, sampleManifest, sampleRepoCopy, tempDir } from './helpers.js';

const CLI = path.join(ROOT, 'bin/featurelens.js');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const GATEWAY = 'src/payment/gateway.client.js';
const SERVICE = 'src/payment/payment.service.js';

/** The draft Claude writes for the sample: the manifest's own parts, evidence as bare locations. */
function sampleDraft() {
  const m = sampleManifest();
  return {
    feature: m.metadata.feature,
    evidence: m.evidence.map(({ snippetHash, ...e }) => e),
    analysis: m.analysis,
    visualizations: m.visualizations,
    sections: m.documentation.sections.map(({ provenance, ...s }) => s),
    summary: 'Initial analysis of the order payment flow.',
  };
}

/** A repository copy and a scratch directory, with the CLI run from the repository root as the skill does. */
function setup(t) {
  const repo = sampleRepoCopy(t);
  const scratch = tempDir(t);
  const at = (name) => path.join(scratch, name);
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env: ENV });
  const json = (...args) => {
    const r = run(...args, '--json');
    return { status: r.status, stderr: r.stderr, report: JSON.parse(r.stdout) };
  };
  const out = path.join(fs.realpathSync(repo), 'docs/features/payment-flow');
  const write = (name, value) => fs.writeFileSync(at(name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const read = (name) => JSON.parse(fs.readFileSync(at(name), 'utf8'));
  write('excerpts.json', '[]');
  const s = {
    repo, scratch, at, run, json, out, write, read,
    build: (draft = sampleDraft()) => {
      write('draft.json', draft);
      return run('build', at('draft.json'), '--repo', '.', '--out', at('manifest.json'));
    },
    render: (file = 'manifest.json', ...extra) => run('render', at(file), '--repo', '.', '--excerpts', at('excerpts.json'), ...extra),
    /** Steps 1-2 of an update: a working copy of the existing manifest.json and its validation. */
    startUpdate: () => {
      fs.copyFileSync(path.join(out, 'manifest.json'), at('revised.json'));
      return json('validate', at('revised.json'), '--repo', '.');
    },
    update: (...extra) => json('update', at('revised.json'), '--repo', '.', '--summary', 'Updated after code changes.', '--out', at('updated.json'), ...extra),
    edit: (file, change) => {
      const abs = path.join(repo, ...file.split('/'));
      fs.writeFileSync(abs, change(fs.readFileSync(abs, 'utf8')));
    },
    revise: (change) => {
      const m = read('revised.json');
      change(m);
      write('revised.json', m);
    },
    /** Everything under the output folder, and whether --out exists: what a refusal must leave alone. */
    snapshot: () => ({ output: tree(out), updated: fs.existsSync(at('updated.json')) }),
  };
  return s;
}

/** A built and rendered sample document: the starting point of every update. */
function documented(t) {
  const s = setup(t);
  assert.equal(s.build().status, 0);
  assert.equal(s.render().status, 0);
  return s;
}

function tree(dir) {
  if (!fs.existsSync(dir)) return null;
  return Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}

const withoutTimes = (m) => JSON.parse(JSON.stringify(m, (k, v) => (['generatedAt', 'updatedAt', 'at'].includes(k) ? undefined : v)));

describe('build', () => {
  test('stamps a draft into a valid manifest outside the output folder, which render then writes', (t) => {
    const s = setup(t);
    const r = s.build();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^✓ built .*manifest\.json: feature "payment-flow", 16 evidence entries \(16 stamped\), 12 section\(s\)\. Next: collect excerpts, then render/);
    assert.equal(tree(s.out), null, 'build writes nothing into the output folder');

    const m = s.read('manifest.json');
    assert.deepEqual(m.evidence.map((e) => e.snippetHash), sampleManifest().evidence.map((e) => e.snippetHash));
    assert.deepEqual(m.history.map((h) => [h.id, h.action]), [['h-1', 'created']]);
    assert.deepEqual(m.history[0].validation, { valid: true, errorCount: 0, warningCount: 0, evidenceChecked: true });
    assert.deepEqual(m.metadata.repository, { name: path.basename(s.repo) });
    assert.deepEqual(m.metadata.generatedBy, { source: 'unknown' });
    assert.equal(s.run('validate', s.at('manifest.json'), '--repo', '.').status, 0);

    const rendered = s.render();
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(fs.readFileSync(path.join(s.out, 'manifest.json'), 'utf8'), serializeManifest(m));
  });

  test('interactive rendering stays opt-in', (t) => {
    const s = documented(t);
    assert.doesNotMatch(fs.readFileSync(path.join(s.out, 'index.html'), 'utf8'), /<script/);
    assert.equal(s.render('manifest.json', '--interactive').status, 0);
    assert.match(fs.readFileSync(path.join(s.out, 'index.html'), 'utf8'), /<script>/);
    assert.equal(s.render().status, 0);
    assert.doesNotMatch(fs.readFileSync(path.join(s.out, 'index.html'), 'utf8'), /<script/, 'not remembered between renders');
  });

  test('is deterministic: the same draft gives the same manifest apart from timestamps', (t) => {
    const s = setup(t);
    assert.equal(s.build().status, 0);
    const first = s.read('manifest.json');
    assert.equal(s.build().status, 0);
    assert.deepEqual(withoutTimes(s.read('manifest.json')), withoutTimes(first));

    const now = new Date('2026-09-24T10:00:00.000Z');
    const context = { repoRoot: SAMPLE_REPO, repository: { name: 'sample-shop' }, generatedBy: { source: 'unknown' }, now };
    const a = buildFromDraft(sampleDraft(), context);
    const b = buildFromDraft(sampleDraft(), context);
    assert.equal(serializeManifest(a.manifest), serializeManifest(b.manifest));
  });

  test('refuses evidence that does not exist, naming every entry, and writes nothing', (t) => {
    const s = setup(t);
    const draft = sampleDraft();
    draft.evidence[0].endLine = 999;
    draft.evidence[1].file = 'src/payment/nope.js';
    const r = s.build(draft);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /error {3}evidence "ev-register": src\/payment\/payment\.controller\.js has \d+ lines, but the reference ends at line 999/);
    assert.match(r.stderr, /error {3}evidence "ev-service-deps": src\/payment\/nope\.js: file not found in repository/);
    assert.match(r.stdout, /not built: 2 evidence location\(s\) do not exist in the repository/);
    assert.equal(fs.existsSync(s.at('manifest.json')), false);
  });

  test('refuses a draft of the wrong shape or an invalid analysis, with actionable messages', (t) => {
    const s = setup(t);
    const extra = { ...sampleDraft(), history: [] };
    delete extra.summary;
    const shape = s.json('build', (s.write('d.json', extra), s.at('d.json')), '--repo', '.', '--out', s.at('manifest.json'));
    assert.equal(shape.status, 1);
    assert.equal(shape.report.refused.step, 'draft');
    assert.deepEqual(shape.report.refused.problems, [
      'unknown key "history"; a draft has only feature, evidence, analysis, visualizations, sections, summary',
      'missing "summary"',
    ]);

    const bad = sampleDraft();
    bad.analysis.findings[0].section = 'internals';
    s.write('d.json', bad);
    const invalid = s.run('build', s.at('d.json'), '--repo', '.', '--out', s.at('manifest.json'));
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /error {3}\[section\.unknown\] \/analysis\/findings\/0\/section: unknown section id "internals"/);

    s.write('d.json', '{ nope');
    assert.equal(s.run('build', s.at('d.json'), '--repo', '.', '--out', s.at('manifest.json')).status, 1);
    assert.equal(fs.existsSync(s.at('manifest.json')), false);
    assert.equal(s.run('build', s.at('d.json'), '--repo', '.').status, 2, '--out is required');
  });

  test('refuses a feature that already has a document, pointing to update', (t) => {
    const s = documented(t);
    const before = s.snapshot();
    fs.rmSync(s.at('manifest.json'));
    const r = s.build();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /feature "payment-flow" already has a document \(docs\/features\/payment-flow\/manifest\.json\); update it instead/);
    assert.equal(fs.existsSync(s.at('manifest.json')), false);
    assert.deepEqual(s.snapshot(), before);
  });

  test('never writes --out into the output directory, even through a symlink', (t) => {
    const s = setup(t);
    s.write('draft.json', sampleDraft());
    fs.mkdirSync(s.out, { recursive: true });
    const inside = s.run('build', s.at('draft.json'), '--repo', '.', '--out', 'docs/features/payment-flow/manifest.json');
    assert.equal(inside.status, 1);
    assert.match(inside.stdout, /is inside the output directory docs\/features/);
    fs.symlinkSync(s.out, s.at('link'));
    const viaLink = s.json('build', s.at('draft.json'), '--repo', '.', '--out', s.at('link/manifest.json'));
    assert.deepEqual([viaLink.status, viaLink.report.refused.step], [1, 'output']);
    assert.deepEqual(tree(s.out), {});
  });
});

describe('update', () => {
  test('with current evidence records a check at this revision and changes no section', (t) => {
    const s = documented(t);
    const v = s.startUpdate();
    assert.deepEqual([v.status, v.report.stale], [0, []]);
    const u = s.update();
    assert.equal(u.status, 0, u.stderr);
    assert.deepEqual([u.report.written, u.report.historyId, u.report.changedSections, u.report.evidence], [true, 'h-2', [], []]);
    assert.ok(u.report.notes.includes('no section changed; the entry records that the document was checked at this revision'));
    assert.equal(s.render('updated.json').status, 0);
  });

  test('with moved evidence: reports the sections, relocates, records and renders', (t) => {
    const s = documented(t);
    s.edit(GATEWAY, (text) => `// moved\n${text}`);
    const v = s.startUpdate();
    assert.equal(v.status, 3);
    const moved = v.report.stale;
    assert.deepEqual(moved.map((x) => [x.evidenceId, x.status, x.action]), [
      ['ev-gateway', 'moved', 'relocate'], ['ev-gateway-url', 'moved', 'relocate'], ['ev-gateway-result', 'moved', 'relocate'],
    ]);
    const previous = s.read('revised.json');
    for (const x of moved) assert.deepEqual(x.sections, sectionsCitingEvidence(previous, [x.evidenceId]), x.evidenceId);

    // Not resolved yet: refused, nothing written.
    const before = s.snapshot();
    const refused = s.update();
    assert.deepEqual([refused.status, refused.report.written, refused.report.refused.step], [3, false, 'write-gate']);
    assert.deepEqual(s.snapshot(), before);

    s.revise((m) => { for (const x of moved) Object.assign(m.evidence.find((e) => e.id === x.evidenceId), x.movedTo); });
    const u = s.update('--changed-file', GATEWAY);
    assert.equal(u.status, 0, u.stderr);
    const ids = moved.map((x) => x.evidenceId);
    assert.deepEqual(u.report.evidence, ids.map((id) => ({ id, stale: 'moved', change: 'edited' })));
    assert.deepEqual(u.report.changedSections, sectionsCitingEvidence(previous, ids).generated);
    assert.deepEqual(u.report.reasons.unknowns, ['shows evidence ev-gateway (moved; updated)', 'shows evidence ev-gateway-result (moved; updated)']);

    const updated = s.read('updated.json');
    const entry = updated.history.at(-1);
    assert.deepEqual(updated.history.slice(0, -1), previous.history);
    assert.deepEqual([entry.id, entry.action, entry.changedFiles, entry.changedSections], ['h-2', 'updated', [GATEWAY], u.report.changedSections]);
    for (const sec of updated.documentation.sections) assert.equal(sec.provenance.historyId === 'h-2', entry.changedSections.includes(sec.id), sec.id);

    assert.equal(s.render('updated.json').status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.out, 'manifest.json'), 'utf8')).history.length, 2);
  });

  test('with changed evidence: refused until re-stamped, then the dependent sections are recorded', (t) => {
    const s = documented(t);
    s.edit(SERVICE, (text) => text.replace("'ORDER_NOT_PAYABLE'", "'ORDER_NOT_PAYABLE_YET'"));
    const v = s.startUpdate();
    assert.deepEqual(v.report.stale.map((x) => [x.evidenceId, x.status, x.action]), [['ev-pay-order', 'changed', 'reanalyze'], ['ev-order-guards', 'changed', 'reanalyze']]);
    assert.ok(v.report.stale[1].claims.includes('/analysis/risks/1'));

    const refused = s.update();
    assert.equal(refused.status, 3);
    assert.match(refused.report.gate.reasons.join('\n'), /evidence "ev-order-guards" is changed; reanalyze it before writing/);
    assert.ok(refused.report.notes.some((n) => /remove its snippetHash; update stamps entries without one/.test(n)));
    assert.equal(fs.existsSync(s.at('updated.json')), false);

    // Claude re-read the code and revised the claims; the entries are re-stamped.
    s.revise((m) => {
      for (const id of ['ev-pay-order', 'ev-order-guards']) delete m.evidence.find((e) => e.id === id).snippetHash;
      m.analysis.risks[1].body = 'Unpayable orders now return ORDER_NOT_PAYABLE_YET.';
    });
    const u = s.update();
    assert.equal(u.status, 0, u.stderr);
    assert.ok(u.report.notes.includes('stamped ev-pay-order, ev-order-guards from the current source'));
    assert.deepEqual(u.report.changedSections, ['overview', 'architecture', 'implementation', 'flows', 'impact', 'risks', 'testing', 'references']);
    assert.ok(u.report.reasons.risks.includes('risks analysis data changed'));
    assert.equal(s.render('updated.json').status, 0);
  });

  test('with missing evidence: a renamed file is followed by re-pointing and re-stamping', (t) => {
    const s = documented(t);
    const from = 'src/orders/order.repository.js';
    const to = 'src/orders/orders.repository.js';
    fs.renameSync(path.join(s.repo, from), path.join(s.repo, to));
    const v = s.startUpdate();
    const missing = v.report.stale.filter((x) => x.status === 'missing').map((x) => x.evidenceId);
    assert.deepEqual(missing, ['ev-order-find', 'ev-order-update']);

    assert.equal(s.update().status, 3);
    s.revise((m) => {
      for (const e of m.evidence) if (e.file === from) { e.file = to; delete e.snippetHash; }
      for (const f of m.analysis.files) if (f.path === from) f.path = to;
    });
    const u = s.update();
    assert.equal(u.status, 0, u.stderr);
    assert.deepEqual(u.report.evidence.map((e) => [e.id, e.stale, e.change]), [['ev-order-find', 'missing', 'edited'], ['ev-order-update', 'missing', 'edited']]);
    assert.ok(u.report.reasons.implementation.includes('implementation analysis data changed'));
  });

  test('with ambiguous evidence: nothing is chosen automatically', (t) => {
    const s = documented(t);
    // Line 12 (ev-gateway-result) now appears twice, and not at line 12.
    s.edit(GATEWAY, (text) => { const lines = text.split('\n'); return [lines[11], ...lines].join('\n'); });
    const v = s.startUpdate();
    const entry = v.report.stale.find((x) => x.evidenceId === 'ev-gateway-result');
    assert.deepEqual([entry.status, entry.action, entry.candidates.length], ['ambiguous', 'review', 2]);

    const refused = s.update();
    assert.equal(refused.status, 3);
    assert.match(refused.report.gate.reasons.join('\n'), /evidence "ev-gateway-result" is ambiguous; review it before writing/);
    s.revise((m) => {
      for (const x of v.report.stale) Object.assign(m.evidence.find((e) => e.id === x.evidenceId), x.movedTo ?? x.candidates[1]);
    });
    const u = s.update();
    assert.equal(u.status, 0, u.stderr);
    assert.deepEqual(u.report.evidence.find((e) => e.id === 'ev-gateway-result'), { id: 'ev-gateway-result', stale: 'ambiguous', change: 'edited' });
  });

  test('a new generated section needs no provenance: update sets it', (t) => {
    const s = documented(t);
    s.startUpdate();
    s.revise((m) => {
      m.documentation.sections.splice(1, 0, { id: 'glossary', title: 'Glossary', kind: 'custom', origin: 'generated', body: 'Terms used here.' });
    });
    const u = s.update();
    assert.equal(u.status, 0, u.stderr);
    assert.deepEqual([u.report.changedSections, u.report.reasons], [['glossary'], { glossary: ['new section'] }]);
    assert.deepEqual(s.read('updated.json').documentation.sections[1].provenance, { historyId: 'h-2' });
  });

  test('is deterministic: the same revision gives the same update', () => {
    const previous = sampleManifest();
    const revised = sampleManifest();
    revised.analysis.risks[0].body = 'Revised.';
    const once = () => {
      const plan = planUpdate(previous, structuredClone(revised));
      return serializeManifest(recordUpdate(structuredClone(revised), {
        by: { source: 'unknown' }, summary: 'Revised a risk.', changedSections: plan.changedSections, now: new Date('2026-09-24T12:00:00.000Z'), repoRoot: SAMPLE_REPO,
      }).manifest);
    };
    assert.equal(once(), once());
    assert.deepEqual(planUpdate(previous, revised).changedSections, ['risks']);
  });

  test('records the git revision chain and refreshes branch and dirty', (t) => {
    const s = setup(t);
    const git = (...args) => execFileSync('git', args, { cwd: s.repo, env: ENV, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', 'commit', '-q', '-m', 'init');
    const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: s.repo, encoding: 'utf8' }).trim();
    assert.equal(s.build().status, 0);
    assert.equal(s.render().status, 0);
    const built = s.read('manifest.json');
    assert.deepEqual([built.metadata.repository.revision, built.metadata.repository.branch, built.history[0].revision], [first, 'main', first]);

    git('checkout', '-q', '-b', 'feature');
    s.edit(GATEWAY, (text) => `${text}\n// appended\n`);
    git('-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', 'commit', '-q', '-am', 'change');
    const second = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: s.repo, encoding: 'utf8' }).trim();
    s.startUpdate();
    const u = s.update('--changed-file', GATEWAY);
    assert.equal(u.status, 0, u.stderr);
    const updated = s.read('updated.json');
    assert.deepEqual(
      [updated.metadata.repository.revision, updated.metadata.repository.branch, updated.history[1].previousRevision, updated.history[1].revision],
      [second, 'feature', first, second],
    );
    assert.equal(updated.metadata.repository.dirty, true, 'the rendered docs folder is untracked');
  });
});

describe('update: manual sections', () => {
  const notes = (m) => m.documentation.sections.find((x) => x.id === 'team-notes');

  test('a changed or removed manual section is refused unless the user asked, and nothing is written', (t) => {
    const s = documented(t);
    s.startUpdate();
    const before = s.snapshot();
    s.revise((m) => { notes(m).body = 'Rewritten.'; });
    const edited = s.update();
    assert.deepEqual([edited.status, edited.report.refused.step], [1, 'plan']);
    assert.match(edited.report.refused.problems[0], /manual section "team-notes" was changed; .* pass --edit-manual team-notes if the user asked for this change/);

    s.startUpdate();
    s.revise((m) => { m.documentation.sections = m.documentation.sections.filter((x) => x.id !== 'team-notes'); });
    assert.match(s.update().report.refused.problems[0], /manual section "team-notes" was removed/);

    s.startUpdate();
    s.revise((m) => { m.documentation.sections.push({ id: 'my-notes', title: 'Mine', kind: 'custom', origin: 'manual', body: 'x', provenance: { historyId: 'h-1' } }); });
    assert.match(s.update().report.refused.problems.join('\n'), /manual section "my-notes" is new; pass --edit-manual my-notes/);

    assert.deepEqual(s.snapshot(), before);
    assert.match(s.update('--edit-manual', 'overview').report.refused.problems.join('\n'), /--edit-manual overview: there is no manual section "overview"/);
  });

  test('an edit the user asked for is recorded as such, and unrelated content is kept', (t) => {
    const s = documented(t);
    s.startUpdate();
    s.revise((m) => { notes(m).body = 'Edited at the user\'s request.'; });
    const u = s.update('--edit-manual', 'team-notes');
    assert.equal(u.status, 0, u.stderr);
    assert.deepEqual(u.report.changedSections, ['team-notes']);
    assert.deepEqual(u.report.reasons, { 'team-notes': ['manual edit requested with --edit-manual'] });
    const previous = JSON.parse(fs.readFileSync(path.join(s.out, 'manifest.json'), 'utf8'));
    const updated = s.read('updated.json');
    for (const [a, b] of previous.documentation.sections.map((x, i) => [x, updated.documentation.sections[i]])) {
      if (a.id !== 'team-notes') assert.deepEqual(b, a, a.id);
    }
    assert.deepEqual(updated.analysis, previous.analysis);
    assert.equal(s.render('updated.json').status, 0);
  });

  test('a removal the user asked for renders; an unrecorded edit is refused by render', (t) => {
    const s = documented(t);
    s.startUpdate();
    s.revise((m) => { m.documentation.sections = m.documentation.sections.filter((x) => x.id !== 'team-notes'); });
    const u = s.update('--edit-manual', 'team-notes');
    assert.deepEqual([u.status, u.report.changedSections, u.report.removedSections], [0, ['team-notes'], ['team-notes']]);
    assert.equal(s.render('updated.json').status, 0);

    // Bypassing update: the writer refuses a manual section changed without a history entry for it.
    const t2 = documented(t);
    const before = t2.snapshot();
    const m = JSON.parse(fs.readFileSync(path.join(t2.out, 'manifest.json'), 'utf8'));
    notes(m).body = 'Silently rewritten.';
    t2.write('silent.json', m);
    const r = t2.json('render', t2.at('silent.json'), '--repo', '.', '--excerpts', t2.at('excerpts.json'));
    assert.deepEqual([r.status, r.report.refused.step, r.report.refused.code, r.report.existing.manualSections], [1, 'existing-output', 'manual-section-changed', ['team-notes']]);
    assert.deepEqual(t2.snapshot(), before);
  });

  test('manual sections citing touched evidence are reported for review, not changed', (t) => {
    const s = setup(t);
    const draft = sampleDraft();
    draft.evidence.push({ id: 'ev-manual', file: GATEWAY, startLine: 12, endLine: 12, kind: 'logic', explanation: 'Cited by the team notes.', confidence: 'high' });
    notes({ documentation: { sections: draft.sections } }).sourceRefs = ['ev-manual'];
    assert.equal(s.build(draft).status, 0);
    assert.equal(s.render().status, 0);

    s.edit(GATEWAY, (text) => `// moved\n${text}`);
    const v = s.startUpdate();
    const manual = v.report.stale.find((x) => x.evidenceId === 'ev-manual');
    assert.deepEqual([manual.manualOnly, manual.action, manual.sections], [true, 'review', { generated: ['references'], manual: ['team-notes'] }]);

    // The generated entries are relocated; the manual-only one is left to the user, who accepts it as is.
    s.revise((m) => { for (const x of v.report.stale) if (!x.manualOnly) Object.assign(m.evidence.find((e) => e.id === x.evidenceId), x.movedTo); });
    assert.equal(s.update().status, 3, 'not acknowledged');
    const u = s.update('--acknowledge', 'ev-manual');
    assert.deepEqual([u.status, u.report.written], [3, true]);
    assert.deepEqual(u.report.manualToReview, [{ id: 'team-notes', reasons: ['cites evidence ev-manual (moved; not updated yet)'] }]);
    assert.ok(!u.report.changedSections.includes('team-notes'));
    assert.equal(s.render('updated.json').status, 3, 'render needs the same acknowledgement');
    assert.equal(s.render('updated.json', '--acknowledge', 'ev-manual').status, 3);
    assert.match(fs.readFileSync(path.join(s.out, 'index.html'), 'utf8'), /unverified/);
  });
});

describe('update: invalid input', () => {
  test('refuses what an update must not do, with actionable messages and no output', (t) => {
    const s = documented(t);
    s.startUpdate();
    const before = s.snapshot();

    s.revise((m) => { m.history[0].summary = 'Rewritten history.'; });
    assert.match(s.update().report.refused.problems.join('\n'), /history differs from the existing manifest\.json; start again from a copy of it and leave history unchanged/);

    fs.copyFileSync(path.join(s.out, 'manifest.json'), s.at('revised.json'));
    s.revise((m) => { m.metadata.feature.id = 'payments'; });
    const other = s.update();
    assert.deepEqual([other.status, other.report.refused.step], [1, 'existing-document']);
    assert.match(other.report.refused.message, /feature "payments" has no document \(docs\/features\/payments\/manifest\.json\); build one first/);

    fs.copyFileSync(path.join(s.out, 'manifest.json'), s.at('revised.json'));
    s.revise((m) => { m.evidence[0].endLine = 999; delete m.evidence[0].snippetHash; });
    const lines = s.update();
    assert.deepEqual([lines.status, lines.report.refused.step], [1, 'evidence']);
    assert.match(lines.report.refused.problems[0], /evidence "ev-register": .* ends at line 999/);

    fs.copyFileSync(path.join(s.out, 'manifest.json'), s.at('revised.json'));
    s.revise((m) => { m.analysis.findings[0].section = 'internals'; });
    const invalid = s.update();
    assert.deepEqual([invalid.status, invalid.report.refused.step], [1, 'validation']);

    assert.deepEqual(s.snapshot(), before);
    assert.equal(s.run('update', s.at('revised.json'), '--repo', '.', '--out', s.at('updated.json')).status, 2, '--summary is required');
    assert.equal(s.run('update', s.at('revised.json'), '--repo', '.', '--summary', 'x').status, 2, '--out is required');
  });

  test('refuses a working copy that already records an update, and an --out in the output folder', (t) => {
    const s = documented(t);
    s.startUpdate();
    assert.equal(s.update().status, 0);
    fs.copyFileSync(s.at('updated.json'), s.at('revised.json'));
    assert.match(s.update().report.refused.problems[0], /already records 1 update\(s\) after "h-1"; render it, or start again/);

    s.startUpdate();
    const inside = s.json('update', s.at('revised.json'), '--repo', '.', '--summary', 'x', '--out', 'docs/features/payment-flow/manifest.json');
    assert.deepEqual([inside.status, inside.report.refused.step], [1, 'output']);
    assert.match(inside.report.refused.message, /inside the output directory/);
  });

  test('update refuses an existing manifest.json reached through a symlink out of the repository', (t) => {
    const s = setup(t);
    const elsewhere = tempDir(t);
    fs.mkdirSync(path.join(s.repo, 'docs'));
    fs.mkdirSync(path.join(elsewhere, 'payment-flow'));
    fs.writeFileSync(path.join(elsewhere, 'payment-flow/manifest.json'), serializeManifest(sampleManifest()));
    fs.symlinkSync(elsewhere, path.join(s.repo, 'docs/features'));
    s.write('revised.json', sampleManifest());
    const u = s.update();
    assert.deepEqual([u.status, u.report.refused.step], [1, 'existing-document']);
    assert.match(u.report.refused.message, /resolves outside the repository/);
    assert.equal(fs.existsSync(s.at('updated.json')), false);
  });

  test('the library refuses without the CLI too', () => {
    const previous = sampleManifest();
    const revised = sampleManifest();
    revised.documentation.sections.find((x) => x.id === 'team-notes').title = 'Renamed';
    assert.throws(() => planUpdate(previous, revised), (e) => e instanceof WorkflowError && /manual section "team-notes" was changed/.test(e.problems[0]));
    assert.equal(validateManifest(revised).valid, true, 'the change itself is valid; only the update refuses it');
  });
});
