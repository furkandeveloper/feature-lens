import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../src/validation/validate.js';
import { sampleManifest, issues } from './helpers.js';

const run = (m) => {
  const r = validateManifest(m);
  return { errors: issues(r.errors), warnings: issues(r.warnings) };
};

describe('dependency graph', () => {
  test('parent chains must not form cycles; each cycle is reported once', () => {
    const m = sampleManifest();
    m.analysis.components[0].parent = 'payment-service'; // payment-module ↔ payment-service
    m.analysis.components[5].parent = 'order-repo';      // self-parent
    assert.deepEqual(run(m).errors, [
      'graph.parent-cycle /analysis/components/0/parent',
      'graph.parent-cycle /analysis/components/5/parent',
    ]);
  });

  test('self-loops and duplicate edges are warnings', () => {
    const m = sampleManifest();
    m.analysis.relationships[0].to = 'pay-route';
    m.analysis.relationships.push({ ...m.analysis.relationships[1], id: 'r-dup' });
    m.analysis.impact.relationships[0].to = 'imp-service';
    const { errors, warnings } = run(m);
    assert.deepEqual(errors.filter((e) => e.startsWith('graph.')), []);
    assert.deepEqual(warnings, [
      'graph.duplicate-edge /analysis/relationships/6',
      'graph.self-loop /analysis/impact/relationships/0',
      'graph.self-loop /analysis/relationships/0',
    ]);
  });
});

describe('architecture views', () => {
  test('edges must be known relationships whose endpoints are nodes of the view', () => {
    const m = sampleManifest();
    const view = m.visualizations.architecture[0];
    view.nodes.splice(6, 1);            // drop card-gateway; r-gateway-api now dangles out of the view
    view.edges.push('r-ghost');
    view.nodes[0].group = 'frontend';
    view.nodes.push({ componentId: 'pay-route' });
    assert.deepEqual(run(m).errors, [
      'graph.edge-outside-view /visualizations/architecture/0/edges/4',
      'id.duplicate /visualizations/architecture/0/nodes/6/componentId',
      'ref.unknown /visualizations/architecture/0/edges/6',
      'ref.unknown /visualizations/architecture/0/nodes/0/group',
    ]);
  });
});

describe('execution flows', () => {
  test('start and next must name steps; unreachable steps are warnings', () => {
    const m = sampleManifest();
    const flow = m.visualizations.executionFlows[0];
    flow.steps[7].next[1].to = 's-ghost';   // s-declined becomes unreachable
    assert.deepEqual(run(m), {
      errors: ['ref.unknown /visualizations/executionFlows/0/steps/7/next/1/to'],
      warnings: ['graph.unreachable /visualizations/executionFlows/0/steps/8'],
    });

    flow.start = 's-nowhere';
    assert.deepEqual(run(m).errors, [
      'ref.unknown /visualizations/executionFlows/0/start',
      'ref.unknown /visualizations/executionFlows/0/steps/7/next/1/to',
    ]);
  });
});

describe('sequences and data flows', () => {
  test('messages and flows must connect declared participants and nodes', () => {
    const m = sampleManifest();
    m.visualizations.sequences[0].messages[2].to = 'database';
    m.visualizations.dataFlows[0].flows[0].from = 'browser';
    m.visualizations.sequences[0].participants.push({ id: 'client', label: 'again' });
    assert.deepEqual(run(m).errors, [
      'id.duplicate /visualizations/sequences/0/participants/6/id',
      'ref.unknown /visualizations/dataFlows/0/flows/0/from',
      'ref.unknown /visualizations/sequences/0/messages/2/to',
    ]);
  });
});

describe('state machines', () => {
  test('need exactly one initial state', () => {
    const m = sampleManifest();
    const sm = m.visualizations.stateMachines[0];
    sm.states[0].initial = false;
    assert.deepEqual(run(m).errors, ['graph.initial-state /visualizations/stateMachines/0/states']);
    sm.states[0].initial = true;
    sm.states[1].initial = true;
    assert.deepEqual(run(m).errors, ['graph.initial-state /visualizations/stateMachines/0/states']);
  });

  test('terminal states have no outgoing transitions; unreachable states are warnings', () => {
    const m = sampleManifest();
    const sm = m.visualizations.stateMachines[0];
    sm.states.push({ id: 'refunded', label: 'refunded', terminal: true });
    sm.transitions.push({ from: 'refunded', to: 'paid', trigger: 'oops', certainty: 'unknown', evidence: [] });
    sm.transitions.push({ from: 'pending', to: 'ghost', trigger: 'x', certainty: 'unknown', evidence: [] });
    assert.deepEqual(run(m), {
      errors: [
        'graph.terminal-outgoing /visualizations/stateMachines/0/transitions/2/from',
        'ref.unknown /visualizations/stateMachines/0/transitions/3/to',
      ],
      warnings: ['graph.unreachable /visualizations/stateMachines/0/states/2'],
    });
  });
});
