import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLE_REPO = path.join(ROOT, 'examples/sample-shop');
export const SAMPLE_MANIFEST = path.join(SAMPLE_REPO, 'featurelens/payment-flow.manifest.json');
export const MINIMAL_MANIFEST = path.join(ROOT, 'test/fixtures/minimal.manifest.json');

/** A fresh deep copy of the example manifest, safe to mutate. */
export function sampleManifest() {
  return JSON.parse(fs.readFileSync(SAMPLE_MANIFEST, 'utf8'));
}

/** A fresh deep copy of the smallest valid manifest, safe to mutate. */
export function minimalManifest() {
  return JSON.parse(fs.readFileSync(MINIMAL_MANIFEST, 'utf8'));
}

/** `"code path"` for each issue, sorted, so tests can compare whole lists. */
export function issues(list) {
  return list.map((i) => `${i.code} ${i.path}`).sort();
}

export function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'featurelens-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A disposable copy of the sample repository, for tests that edit source files. */
export function sampleRepoCopy(t) {
  const dir = tempDir(t);
  fs.cpSync(path.join(SAMPLE_REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  return dir;
}

/**
 * The sample plus components that depend on the payment route, so the impact
 * diagram has derived nodes and edges, a wide layer, and nodes that are not
 * neighbors of PaymentService.
 */
export function derivedImpactManifest() {
  const m = sampleManifest();
  const claim = { certainty: 'proposed', evidence: [] };
  for (let i = 1; i <= 5; i++) {
    m.analysis.components.push({ id: `client-${i}`, name: `Client ${i}`, kind: 'module', summary: `Client ${i}.`, ...claim });
    m.analysis.relationships.push({ id: `r-client-${i}`, from: `client-${i}`, to: 'pay-route', kind: 'calls', ...claim });
  }
  m.analysis.components.push({ id: 'admin', name: 'Admin console', kind: 'module', summary: 'Admin.', ...claim });
  m.analysis.relationships.push({ id: 'r-admin', from: 'admin', to: 'client-1', kind: 'calls', ...claim });
  return m;
}

/** A stale entry for one evidence id, as validation reports it for changed code. */
export function staleEntry(manifest, evidenceId) {
  const i = manifest.evidence.findIndex((e) => e.id === evidenceId);
  return {
    evidenceId, path: `/evidence/${i}`, file: manifest.evidence[i].file, status: 'changed', action: 'reanalyze',
    claims: [], manualSections: [], manualOnly: false, message: 'changed',
  };
}
