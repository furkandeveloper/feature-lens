import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImpactGraph } from '../src/analysis/impact-graph.js';
import { sampleManifest, minimalManifest } from './helpers.js';

test('builds nodes from components plus file-only impact items', () => {
  const { nodes } = buildImpactGraph(sampleManifest());
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  assert.equal(nodes.length, 9);
  assert.deepEqual(byId['payment-service'].impact, { level: 'high', changes: ['review'], items: ['imp-service'] });
  assert.deepEqual(byId['file:src/payment/idempotency.store.js'], {
    id: 'file:src/payment/idempotency.store.js',
    label: 'src/payment/idempotency.store.js',
    kind: 'file',
    certainty: 'proposed',
    impact: { level: 'medium', changes: ['add'], items: ['imp-idempotency'] },
    indirect: false,
  });
  assert.equal(byId['gateway-client'].impact, null);
  assert.equal(byId['pay-route'].parent, 'payment-module');
});

test('marks components that depend on a directly impacted one', () => {
  const { nodes } = buildImpactGraph(sampleManifest());
  const indirect = nodes.filter((n) => n.indirect).map((n) => n.id);
  // pay-route calls payment-service, but is itself directly impacted, so not "indirect".
  // Nothing else depends on payment-service, payment-repo or pay-route.
  assert.deepEqual(indirect, []);

  const m = sampleManifest();
  m.analysis.impact.items = [{ id: 'imp-gw', componentId: 'card-gateway', level: 'high', change: 'review', reason: 'API v2', certainty: 'proposed', evidence: [] }];
  m.analysis.impact.relationships = [];
  const deps = buildImpactGraph(m).nodes.filter((n) => n.indirect).map((n) => n.id).sort();
  assert.deepEqual(deps, ['gateway-client', 'pay-route', 'payment-service']);
});

test('reversed relationship kinds propagate the other way', () => {
  const m = minimalManifest();
  const c = (id) => ({ id, name: id, kind: 'config', summary: id, certainty: 'unknown', evidence: [] });
  m.analysis.components = [c('settings'), c('worker')];
  m.analysis.relationships = [{ id: 'r', from: 'settings', to: 'worker', kind: 'configures', certainty: 'unknown', evidence: [] }];
  m.analysis.impact.items = [{ id: 'i', componentId: 'settings', level: 'low', change: 'modify', reason: 'x', certainty: 'proposed', evidence: [] }];
  const worker = buildImpactGraph(m).nodes.find((n) => n.id === 'worker');
  assert.equal(worker.indirect, true);
});

test('edges include dependencies and impact relationships mapped to node ids', () => {
  const { edges } = buildImpactGraph(sampleManifest());
  assert.equal(edges.filter((e) => e.type === 'dependency').length, 6);
  assert.deepEqual(edges.find((e) => e.id === 'ir-idempotency-service'), {
    id: 'ir-idempotency-service',
    from: 'file:src/payment/idempotency.store.js',
    to: 'payment-service',
    type: 'impact',
    kind: 'impact',
    label: 'payOrder would have to check and record the key around the gateway call.',
    certainty: 'proposed',
    evidence: ['ev-charge-call'],
  });
});
