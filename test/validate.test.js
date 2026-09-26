import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../src/validation/validate.js';
import { checkSchemaVersion, SCHEMA_VERSION } from '../src/version.js';
import { SAMPLE_REPO, sampleManifest, minimalManifest, issues } from './helpers.js';

const errorsOf = (m, options) => issues(validateManifest(m, options).errors);

describe('valid manifests', () => {
  test('the example manifest is valid, with evidence checked against the sample repo', () => {
    const result = validateManifest(sampleManifest(), { repoRoot: SAMPLE_REPO });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.valid, true);
    assert.equal(result.evidenceChecked, true);
  });

  test('the minimal manifest is valid: no evidence, no visualizations', () => {
    const result = validateManifest(minimalManifest());
    assert.deepEqual(result.errors, []);
    assert.equal(result.evidenceChecked, false);
  });

  test('every visualization type is optional', () => {
    for (const type of ['architecture', 'executionFlows', 'sequences', 'stateMachines', 'dataFlows']) {
      const m = sampleManifest();
      const ids = new Set(m.visualizations[type].map((v) => v.id));
      delete m.visualizations[type];
      for (const s of m.documentation.sections) if (s.visualizations) s.visualizations = s.visualizations.filter((id) => !ids.has(id));
      assert.deepEqual(errorsOf(m, { repoRoot: SAMPLE_REPO }), [], type);
    }
  });

  test('change-impact mode requires a proposed change', () => {
    const m = sampleManifest();
    m.metadata.feature.mode = 'change-impact';
    assert.deepEqual(errorsOf(m), ['feature.proposed-change /metadata/feature/proposedChange']);
    m.metadata.feature.proposedChange = 'Add refund support.';
    assert.deepEqual(errorsOf(m), []);
  });
});

describe('schema versions', () => {
  test('supported: same major, minor not newer', () => {
    assert.equal(checkSchemaVersion(SCHEMA_VERSION), null);
    assert.equal(checkSchemaVersion('1.0.7'), null);
  });

  test('unsupported versions stop validation with a single clear error', () => {
    for (const version of ['2.0.0', '0.9.0', '1.1.0', '1.0', 'v1.0.0', '01.0.0', 1]) {
      const m = sampleManifest();
      m.schemaVersion = version;
      delete m.metadata; // would be a schema error, but the version check comes first
      const result = validateManifest(m);
      assert.deepEqual(issues(result.errors), ['version.unsupported /schemaVersion'], String(version));
    }
  });

  test('a newer minor asks for an upgrade', () => {
    assert.match(checkSchemaVersion('1.4.0'), /newer than this tool supports.*upgrade featurelens/);
  });

  test('a missing schemaVersion is a required-field error', () => {
    const m = sampleManifest();
    delete m.schemaVersion;
    assert.deepEqual(errorsOf(m), ['schema.required /']);
  });
});

describe('missing and malformed fields', () => {
  test('reports missing required fields with the path of the parent', () => {
    const m = sampleManifest();
    delete m.metadata.feature.description;
    delete m.evidence[0].explanation;
    delete m.analysis.impact.relationships;
    delete m.documentation.sections[0].provenance;
    assert.deepEqual(errorsOf(m), [
      'schema.required /analysis/impact',
      'schema.required /documentation/sections/0',
      'schema.required /evidence/0',
      'schema.required /metadata/feature',
    ]);
  });

  test('rejects non-objects and unknown properties', () => {
    assert.deepEqual(errorsOf(null), ['schema.type /']);
    assert.deepEqual(errorsOf([]), ['schema.type /']);
    const m = sampleManifest();
    m.analysis.components[0].owner = 'team-a';
    assert.deepEqual(errorsOf(m), ['schema.additionalProperties /analysis/components/0/owner']);
  });

  test('rejects invalid enum values, ids and timestamps', () => {
    const m = sampleManifest();
    m.analysis.findings[0].certainty = 'probably';
    m.evidence[0].confidence = 'certain';
    m.analysis.components[0].id = 'Payment Module';
    m.metadata.generatedAt = 'yesterday';
    assert.deepEqual(errorsOf(m), [
      'schema.enum /analysis/findings/0/certainty',
      'schema.enum /evidence/0/confidence',
      'schema.format /metadata/generatedAt',
      'schema.pattern /analysis/components/0/id',
    ]);
  });

  test('schema errors short-circuit semantic checks', () => {
    const m = sampleManifest();
    m.analysis.relationships[0].to = 'ghost'; // semantic error, not reported yet
    delete m.metadata.tool;
    assert.deepEqual(errorsOf(m), ['schema.required /metadata']);
  });
});

describe('references', () => {
  test('detects dangling references everywhere they can occur', () => {
    const m = sampleManifest();
    m.analysis.relationships[0].to = 'ghost';
    m.analysis.components[1].evidence = ['ev-missing'];
    m.analysis.components[2].parent = 'ghost';
    m.analysis.impact.items[0].componentId = 'ghost';
    m.analysis.impact.relationships[0].to = 'imp-ghost';
    m.analysis.scope.entryPoints = ['ghost'];
    m.analysis.files[0].evidence = ['ev-missing'];
    m.documentation.sections[0].sourceRefs = ['ev-missing'];
    m.documentation.sections[2].visualizations = ['viz-ghost'];
    m.visualizations.sequences[0].participants[1].componentId = 'ghost';
    assert.deepEqual(errorsOf(m), [
      'ref.unknown /analysis/components/1/evidence/0',
      'ref.unknown /analysis/components/2/parent',
      'ref.unknown /analysis/files/0/evidence/0',
      'ref.unknown /analysis/impact/items/0/componentId',
      'ref.unknown /analysis/impact/relationships/0/to',
      'ref.unknown /analysis/relationships/0/to',
      'ref.unknown /analysis/scope/entryPoints/0',
      'ref.unknown /documentation/sections/0/sourceRefs/0',
      'ref.unknown /documentation/sections/2/visualizations/0',
      'ref.unknown /visualizations/sequences/0/participants/1/componentId',
    ]);
  });

  test('observed and inferred claims require evidence; proposed and unknown do not', () => {
    const m = sampleManifest();
    m.analysis.findings[0].evidence = [];                        // observed
    m.analysis.risks[0].evidence = [];                           // inferred
    m.visualizations.sequences[0].messages[0].evidence = [];     // observed
    m.analysis.testing[0].evidence = [];                         // proposed
    m.analysis.impact.relationships[2].evidence = [];            // proposed
    m.analysis.components[0].certainty = 'unknown';
    m.analysis.components[0].evidence = [];
    assert.deepEqual(errorsOf(m), [
      'evidence.required /analysis/findings/0/evidence',
      'evidence.required /analysis/risks/0/evidence',
      'evidence.required /visualizations/sequences/0/messages/0/evidence',
    ]);
  });

  test('detects duplicate ids', () => {
    const m = sampleManifest();
    m.analysis.components.push({ ...m.analysis.components[0] });
    m.evidence.push({ ...m.evidence[0] });
    m.analysis.files.push({ ...m.analysis.files[0] });
    m.visualizations.dataFlows[0].id = m.visualizations.sequences[0].id;
    assert.deepEqual(errorsOf(m), [
      'id.duplicate /analysis/components/8/id',
      'id.duplicate /analysis/files/5/path',
      'id.duplicate /evidence/16/id',
      'id.duplicate /visualizations/dataFlows/0/id',
      'ref.unknown /documentation/sections/4/visualizations/2', // the renamed data flow
    ]);
  });

  test('impact items must name a component or a file', () => {
    const m = sampleManifest();
    delete m.analysis.impact.items[3].file;
    assert.deepEqual(errorsOf(m), ['impact.missing-target /analysis/impact/items/3']);
  });

  test('endpoint and dependency details only fit their component kinds', () => {
    const m = sampleManifest();
    m.analysis.components[1].kind = 'function';
    m.analysis.components[7].kind = 'service';
    assert.deepEqual(errorsOf(m), [
      'component.detail-mismatch /analysis/components/1/endpoint',
      'component.detail-mismatch /analysis/components/7/dependency',
    ]);
  });
});

describe('section identifiers', () => {
  test('rejects malformed and duplicate section ids', () => {
    const m = sampleManifest();
    m.documentation.sections[0].id = 'Team Notes';
    assert.deepEqual(errorsOf(m), ['schema.pattern /documentation/sections/0/id']);

    const m2 = sampleManifest();
    m2.documentation.sections[1].id = 'overview';
    const errors = errorsOf(m2);
    assert.ok(errors.includes('id.duplicate /documentation/sections/1/id'), errors.join('\n'));
  });

  test('findings must belong to an existing section', () => {
    const m = sampleManifest();
    m.analysis.findings[1].section = 'internals';
    assert.deepEqual(errorsOf(m), ['section.unknown /analysis/findings/1/section']);
  });

  test('section provenance must point at a history entry that changed the section', () => {
    const m = sampleManifest();
    m.documentation.sections[0].provenance.historyId = 'h-9';
    m.documentation.sections[1].provenance.historyId = 'h-2'; // h-2 only changed team-notes
    assert.deepEqual(errorsOf(m), [
      'ref.unknown /documentation/sections/0/provenance/historyId',
      'section.provenance /documentation/sections/1/provenance/historyId',
    ]);
  });

  test('manual sections need a body and should not hold generated findings', () => {
    const m = sampleManifest();
    delete m.documentation.sections[10].body;
    m.analysis.findings[0].section = 'team-notes';
    const result = validateManifest(m);
    assert.deepEqual(issues(result.errors), ['section.manual-body /documentation/sections/10/body']);
    assert.deepEqual(issues(result.warnings), ['section.manual-findings /documentation/sections/10']);
  });

  test('history may mention a section that has since been removed, with a warning', () => {
    const m = sampleManifest();
    m.documentation.sections.splice(9, 1); // references
    const result = validateManifest(m);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(issues(result.warnings), ['history.unknown-section /history/0/changedSections/9']);
  });
});
