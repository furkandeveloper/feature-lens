import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createManifest, recordUpdate, sectionsCitingEvidence } from '../src/manifest/build.js';
import { SCHEMA_VERSION, TOOL_VERSION } from '../src/version.js';
import { SAMPLE_REPO, sampleManifest, minimalManifest, issues } from './helpers.js';

function minimalInput(overrides = {}) {
  const m = minimalManifest();
  return {
    feature: m.metadata.feature,
    repository: { name: 'nowhere', revision: 'aaaaaaa' },
    generatedBy: { name: 'Ada', source: 'git-config' },
    evidence: [],
    analysis: m.analysis,
    sections: [{ id: 'overview', title: 'Overview', kind: 'overview', origin: 'generated' }],
    summary: 'First pass.',
    now: new Date('2026-09-23T10:00:00Z'),
    ...overrides,
  };
}

describe('createManifest', () => {
  test('undefined optional fields are dropped, so what is validated and recorded is what gets written (Phase 3E)', () => {
    const m = minimalManifest();
    const analysis = { ...m.analysis, components: [{ id: 'c', name: 'C', kind: 'module', summary: 'S.', certainty: 'unknown', evidence: [], parent: undefined }] };
    const { manifest, validation } = createManifest(minimalInput({ analysis, contributors: undefined, visualizations: undefined }));
    assert.deepEqual(validation.errors, []);
    assert.equal(manifest.history[0].validation.valid, true);
    assert.equal(Object.hasOwn(manifest.analysis.components[0], 'parent'), false);
    const { manifest: next, validation: v2 } = recordUpdate(manifest, { by: { source: 'unknown' }, summary: 'x', changedSections: [], changedFiles: undefined, revision: undefined, now: new Date('2026-09-24T10:00:00Z') });
    assert.deepEqual(v2.errors, []);
    assert.equal(next.history[1].validation.valid, true);
  });

  test('fills metadata and a creation entry that owns every section', () => {
    const { manifest, validation } = createManifest(minimalInput());
    assert.deepEqual(validation.errors, []);
    assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(manifest.metadata.tool, { name: 'featurelens', version: TOOL_VERSION });
    assert.equal(manifest.metadata.generatedAt, '2026-09-23T10:00:00.000Z');
    assert.equal(manifest.metadata.updatedAt, manifest.metadata.generatedAt);
    assert.deepEqual(manifest.visualizations, {});
    assert.deepEqual(manifest.documentation.sections[0].provenance, { historyId: 'h-1' });
    assert.deepEqual(manifest.history, [{
      id: 'h-1',
      at: '2026-09-23T10:00:00.000Z',
      action: 'created',
      by: { name: 'Ada', source: 'git-config' },
      toolVersion: TOOL_VERSION,
      summary: 'First pass.',
      revision: 'aaaaaaa',
      changedFiles: [],
      changedSections: ['overview'],
      validation: { valid: true, errorCount: 0, warningCount: 0, evidenceChecked: false },
    }]);
  });

  test('records a failed validation instead of throwing, and does not share input objects', () => {
    const input = minimalInput();
    input.analysis.findings.push({ id: 'f-1', section: 'nowhere', title: 't', body: 'b', certainty: 'observed', evidence: [] });
    const { manifest, validation } = createManifest(input);
    assert.deepEqual(issues(validation.errors), ['evidence.required /analysis/findings/0/evidence', 'section.unknown /analysis/findings/0/section']);
    assert.deepEqual(manifest.history[0].validation, { valid: false, errorCount: 2, warningCount: 0, evidenceChecked: false });
    manifest.analysis.findings.pop();
    assert.equal(input.analysis.findings.length, 1);
  });
});

describe('recordUpdate', () => {
  function gitSample() {
    const m = sampleManifest();
    m.history[0].revision = 'aaaaaaa';
    m.history[1].previousRevision = 'aaaaaaa';
    m.history[1].revision = 'bbbbbbb';
    m.metadata.repository.revision = 'bbbbbbb';
    return m;
  }

  test('appends a chained entry and moves provenance for changed sections only', () => {
    const before = gitSample();
    const snapshot = structuredClone(before);
    const { manifest, validation } = recordUpdate(before, {
      by: { name: 'Grace', source: 'git-config' },
      summary: 'Re-checked the implementation after a refactor.',
      changedSections: ['implementation'],
      changedFiles: ['src/payment/payment.service.js'],
      revision: 'ccccccc',
      now: new Date('2026-09-24T09:00:00Z'),
      repoRoot: SAMPLE_REPO,
    });

    assert.deepEqual(validation.errors, []);
    assert.deepEqual(before, snapshot, 'input is not modified');
    const entry = manifest.history.at(-1);
    assert.equal(entry.id, 'h-3');
    assert.equal(entry.previousRevision, 'bbbbbbb');
    assert.equal(entry.revision, 'ccccccc');
    assert.deepEqual(entry.validation, { valid: true, errorCount: 0, warningCount: 0, evidenceChecked: true });
    assert.equal(manifest.metadata.updatedAt, '2026-09-24T09:00:00.000Z');
    assert.equal(manifest.metadata.repository.revision, 'ccccccc');

    const provenance = Object.fromEntries(manifest.documentation.sections.map((s) => [s.id, s.provenance.historyId]));
    assert.equal(provenance.implementation, 'h-3');
    assert.equal(provenance['team-notes'], 'h-2');
    assert.equal(provenance.overview, 'h-1');
  });

  test('an update dated before the last entry is recorded as invalid', () => {
    const { validation, manifest } = recordUpdate(sampleManifest(), {
      by: { source: 'unknown' },
      summary: 'Clock skew.',
      changedSections: [],
      now: new Date('2026-09-01T00:00:00Z'),
    });
    assert.deepEqual(issues(validation.errors), ['history.order /history/2/at']);
    assert.equal(manifest.history.at(-1).validation.valid, false);
  });
});

describe('sectionsCitingEvidence', () => {
  test('maps evidence to the sections that present it, in manifest order', () => {
    const m = sampleManifest();
    // ev-gateway: a component, a file and an unknown cite it, so architecture, implementation, unknowns, plus the catalog.
    assert.deepEqual(sectionsCitingEvidence(m, ['ev-gateway']), { generated: ['architecture', 'implementation', 'unknowns', 'references'], manual: [] });
    // ev-pay-order is also a sourceRef of the overview section, and an impact item cites it.
    assert.deepEqual(sectionsCitingEvidence(m, ['ev-pay-order']).generated, ['overview', 'architecture', 'implementation', 'impact', 'references']);
    // Visualizations listed in flows cite ev-declined.
    assert.ok(sectionsCitingEvidence(m, ['ev-declined']).generated.includes('flows'));
  });

  test('marks nothing without evidence, and never scope, history or unrelated sections', () => {
    const m = sampleManifest();
    assert.deepEqual(sectionsCitingEvidence(m, []), { generated: [], manual: [] });
    const all = sectionsCitingEvidence(m, m.evidence.map((e) => e.id));
    for (const id of ['scope', 'history', 'team-notes']) assert.ok(!all.generated.includes(id) && !all.manual.includes(id), id);
  });

  test('manual sections are reported separately and only for what they show themselves', () => {
    const m = sampleManifest();
    const notes = m.documentation.sections.find((s) => s.id === 'team-notes');
    notes.kind = 'architecture';
    assert.deepEqual(sectionsCitingEvidence(m, ['ev-gateway']).manual, [], 'manual sections show no kind data');
    notes.sourceRefs = ['ev-gateway'];
    assert.deepEqual(sectionsCitingEvidence(m, ['ev-gateway']).manual, ['team-notes']);
  });

  test('a finding counts for the section it is placed in', () => {
    const m = sampleManifest();
    m.analysis.findings.push({ id: 'f-x', section: 'scope', title: 't', body: 'b', certainty: 'observed', evidence: ['ev-route'] });
    assert.ok(sectionsCitingEvidence(m, ['ev-route']).generated.includes('scope'));
  });

  test('removed evidence is matched against the manifest it was removed from', () => {
    const before = sampleManifest();
    const after = structuredClone(before);
    after.evidence = after.evidence.filter((e) => e.id !== 'ev-order-update');
    after.analysis.components.forEach((c) => { c.evidence = c.evidence.filter((id) => id !== 'ev-order-update'); });
    after.analysis.files.forEach((f) => { f.evidence = f.evidence?.filter((id) => id !== 'ev-order-update'); });
    assert.deepEqual(sectionsCitingEvidence(after, ['ev-order-update']).generated, ['references']);
    assert.deepEqual(sectionsCitingEvidence(before, ['ev-order-update']).generated, ['architecture', 'implementation', 'references']);
  });
});
