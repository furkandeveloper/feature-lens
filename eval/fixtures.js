// Deterministic evaluation repositories (docs/EVALUATION.md). Each builder
// writes a small source tree into `dir`, stamps evidence against it with
// createSourceRef exactly as the skill does, and returns the manifest from
// createManifest plus the excerpts Claude Code would collect. No clock, no
// randomness: the same arguments give the same bytes.

import fs from 'node:fs';
import path from 'node:path';
import { SourceTree, createSourceRef } from '../src/evidence/source.js';
import { createManifest } from '../src/manifest/build.js';

const NOW = new Date('2026-09-24T12:00:00.000Z');
const SECTIONS_ALL = [
  { id: 'overview', title: 'Overview', kind: 'overview', origin: 'generated' },
  { id: 'architecture', title: 'Architecture', kind: 'architecture', origin: 'generated' },
  { id: 'impact', title: 'Impact', kind: 'impact', origin: 'generated' },
  { id: 'unknowns', title: 'Unknowns', kind: 'unknowns', origin: 'generated' },
  { id: 'references', title: 'Evidence', kind: 'references', origin: 'generated' },
  { id: 'history', title: 'History', kind: 'history', origin: 'generated' },
];

function write(dir, file, text) {
  const abs = path.join(dir, ...file.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** The excerpt Claude Code would collect for each evidence entry: the cited lines, read from disk. */
export function collectExcerpts(repoRoot, evidence) {
  const tree = new SourceTree(repoRoot);
  return evidence.map((ev) => ({
    evidenceId: ev.id, file: ev.file, startLine: ev.startLine, endLine: ev.endLine,
    text: tree.lines(ev.file).slice(ev.startLine - 1, ev.endLine).join('\n'),
  }));
}

function stamp(dir, entries) {
  const tree = new SourceTree(dir);
  return entries.map((e) => createSourceRef(tree, { kind: 'definition', confidence: 'high', explanation: `Defines ${e.symbol ?? e.id}.`, ...e }).ref);
}

/** Every cited file listed in analysis.files, as a careful analysis would. */
function listFiles(analysis, evidence) {
  const listed = new Set(analysis.files.map((f) => f.path));
  const files = [...analysis.files];
  for (const ev of evidence) {
    if (!listed.has(ev.file)) files.push({ path: ev.file, role: 'supporting', reason: 'Cited as evidence.' });
    listed.add(ev.file);
  }
  return { ...analysis, files };
}

function finish(dir, input) {
  const { manifest, validation } = createManifest({
    generatedBy: { source: 'unknown' }, now: NOW, repoRoot: dir, visualizations: {}, sections: SECTIONS_ALL, ...input,
    analysis: listFiles(input.analysis, input.evidence),
  });
  if (!validation.valid) throw new Error(`fixture ${input.feature.id} is invalid: ${JSON.stringify(validation.errors.slice(0, 5))}`);
  return { manifest, excerpts: collectExcerpts(dir, manifest.evidence), validation };
}

const emptyAnalysis = () => ({
  scope: { summary: 'Evaluation fixture.', inScope: [], outOfScope: [] },
  files: [], components: [], relationships: [], findings: [],
  impact: { summary: '', items: [], relationships: [] }, risks: [], testing: [], unknowns: [],
});

/**
 * A layered service graph: `layers` layers of `width` modules each, every
 * module calling `fanout` modules of the next layer, with `direct` impact
 * items on the bottom layer so derived impact reaches most of the graph.
 * One architecture view per `views` groups the modules by layer.
 */
export function layeredGraph(dir, { id, layers, width, fanout = 2, direct = 4, groups = true, hub = 0 }) {
  const names = [];
  const files = new Map();
  for (let l = 0; l < layers; l++) {
    for (let w = 0; w < width; w++) {
      const name = `m${l}_${w}`;
      names.push({ name, l, w });
      const file = `src/layer${l}/${name}.js`;
      const calls = l + 1 < layers ? Array.from({ length: fanout }, (_, k) => `m${l + 1}_${(w + k) % width}`) : [];
      files.set(name, file);
      write(dir, file, `// ${name}\n${calls.map((c) => `import { ${c} } from '../layer${l + 1}/${c}.js';`).join('\n')}\nexport function ${name}(input) {\n  return [${calls.map((c) => `${c}(input)`).join(', ')}];\n}\n`);
    }
  }
  // A hub every other module depends on: one very wide derived layer.
  for (let h = 0; h < hub; h++) {
    const name = `client${h}`;
    names.push({ name, l: -1, w: h });
    files.set(name, `src/clients/${name}.js`);
    write(dir, files.get(name), `// ${name}\nimport { m${layers - 1}_0 } from '../layer${layers - 1}/m${layers - 1}_0.js';\nexport function ${name}(x) {\n  return m${layers - 1}_0(x);\n}\n`);
  }
  const evidence = stamp(dir, names.map(({ name }) => {
    const lines = fs.readFileSync(path.join(dir, files.get(name)), 'utf8').split('\n');
    const start = lines.findIndex((x) => x.startsWith('export function')) + 1;
    return { id: `ev-${name}`, file: files.get(name), startLine: start, endLine: start + 2, symbol: name };
  }));
  const obs = (name) => ({ certainty: 'observed', evidence: [`ev-${name}`] });
  const components = names.map(({ name, l }) => ({ id: name.replace('_', '-'), name: `Module ${name} (layer ${l})`, kind: 'module', summary: `Module ${name}.`, ...obs(name) }));
  const cid = (name) => name.replace('_', '-');
  const relationships = [];
  for (const { name, l, w } of names) {
    if (l < 0) {
      relationships.push({ id: `r-${cid(name)}`, from: cid(name), to: cid(`m${layers - 1}_0`), kind: 'calls', ...obs(name) });
      continue;
    }
    if (l + 1 >= layers) continue;
    for (let k = 0; k < fanout; k++) {
      const to = `m${l + 1}_${(w + k) % width}`;
      relationships.push({ id: `r-${cid(name)}-${cid(to)}`, from: cid(name), to: cid(to), kind: 'calls', ...obs(name) });
    }
  }
  const bottom = names.filter((n) => n.l === layers - 1).slice(0, direct);
  const items = bottom.map(({ name }, i) => ({ id: `imp-${cid(name)}`, componentId: cid(name), level: ['high', 'medium', 'low'][i % 3], change: 'modify', reason: `The change lands in ${name}.`, ...obs(name) }));
  const impactRels = items.slice(1).map((it, i) => ({ id: `ir-${i}`, from: items[0].id, to: it.id, reason: 'Shared contract.', certainty: 'inferred', evidence: items[0].evidence }));
  const analysis = {
    ...emptyAnalysis(),
    scope: { summary: `A ${layers}×${width} layered service graph.`, inScope: ['everything'], outOfScope: [] },
    components, relationships,
    impact: { summary: 'Changing the bottom layer.', items, relationships: impactRels },
  };
  const visualizations = groups ? {
    architecture: [{
      id: 'arch-all', title: 'All modules by layer',
      groups: [...Array.from({ length: layers }, (_, l) => ({ id: `g${l}`, label: `Layer ${l}` })), ...(hub ? [{ id: 'gc', label: 'Clients' }] : [])],
      nodes: names.map(({ name, l }) => ({ componentId: cid(name), group: l < 0 ? 'gc' : `g${l}` })),
      edges: relationships.map((r) => r.id),
    }],
  } : {};
  const sections = SECTIONS_ALL.map((s) => (s.id === 'architecture' && groups ? { ...s, visualizations: ['arch-all'] } : s));
  return finish(dir, {
    feature: { id, name: `Layered graph ${layers}×${width}`, description: 'Synthetic layered service graph for scale evaluation.', mode: 'change-impact', request: 'What does changing the bottom layer impact?', proposedChange: 'Change the storage contract of the bottom layer.' },
    repository: { name: id }, evidence, analysis, visualizations, sections, summary: 'Created for evaluation.',
  });
}

/**
 * Many architecture groups: 12 groups of 1–6 nodes, cross-group edges,
 * an empty group, ungrouped nodes, long group labels.
 */
export function manyGroups(dir) {
  const groupDefs = Array.from({ length: 12 }, (_, g) => ({ id: `g${g}`, label: g === 3 ? 'Payments, billing, invoicing and everything else finance owns across regions' : `Bounded context ${g}`, size: (g * 5) % 6 + 1 }));
  const nodes = [];
  for (const g of groupDefs) for (let i = 0; i < g.size; i++) nodes.push({ name: `svc_${g.id}_${i}`, group: g.id });
  nodes.push({ name: 'loose_a' }, { name: 'loose_b' });
  write(dir, 'src/services.js', nodes.map((n) => `export function ${n.name}() {\n  return '${n.name}';\n}\n`).join(''));
  const evidence = stamp(dir, nodes.map((n, i) => ({ id: `ev-${n.name.replaceAll('_', '-')}`, file: 'src/services.js', startLine: i * 3 + 1, endLine: i * 3 + 3, symbol: n.name })));
  const cid = (n) => n.replaceAll('_', '-');
  const obs = (n) => ({ certainty: 'observed', evidence: [`ev-${cid(n)}`] });
  const components = nodes.map((n) => ({ id: cid(n.name), name: n.name.replaceAll('_', ' '), kind: 'service', summary: `Service ${n.name}.`, ...obs(n.name) }));
  const relationships = [];
  nodes.forEach((n, i) => {
    for (const j of [i + 1, i + 7, i * 3 + 2]) {
      if (j < nodes.length && j !== i) relationships.push({ id: `r-${i}-${j}`, from: cid(n.name), to: cid(nodes[j].name), kind: i % 2 ? 'calls' : 'reads', ...obs(n.name) });
    }
  });
  const items = [{ id: 'imp-a', componentId: cid(nodes.at(-3).name), level: 'high', change: 'modify', reason: 'Changed.', ...obs(nodes.at(-3).name) }];
  const view = {
    id: 'arch-groups', title: 'Bounded contexts',
    groups: [...groupDefs.map(({ id, label }) => ({ id, label })), { id: 'g-empty', label: 'Empty group' }],
    nodes: nodes.map((n) => ({ componentId: cid(n.name), ...(n.group ? { group: n.group } : {}) })),
    edges: relationships.map((r) => r.id),
  };
  return finish(dir, {
    feature: { id: 'many-groups', name: 'Many architecture groups', description: 'Twelve groups of different sizes, an empty group and ungrouped nodes.', mode: 'existing-feature', request: 'Map the bounded contexts.' },
    repository: { name: 'many-groups' }, evidence,
    analysis: { ...emptyAnalysis(), components, relationships, impact: { summary: '', items, relationships: [] } },
    visualizations: { architecture: [view] },
    sections: SECTIONS_ALL.map((s) => (s.id === 'architecture' ? { ...s, visualizations: ['arch-groups'] } : s)),
    summary: 'Created for evaluation.',
  });
}

export const HOSTILE = [
  '</script><script>alert(1)</script>',
  '"><img src=x onerror=alert(2)>',
  "'><svg onload=alert(3)>",
  '<!-- featurelens {"historyId":"h-9"} -->',
  'javascript:alert(4)',
  '‮gnp.exe‬ RTL override',
  'zero​width‍joiner',
  '&lt;already&gt; &amp; escaped',
  '${alert(5)} `template`',
  'emoji 🧪🔥 and CJK 付款流程 and Arabic الدفع',
];

/**
 * Hostile labels, ids, paths and unusually long text everywhere a manifest
 * carries text, in an impact diagram, an architecture view and a flow.
 */
export function hostile(dir) {
  const files = ['src/we ird/<img src=x onerror=alert(1)>.js', 'src/ünïcødé/файл.js', 'src/#hash?q=1&x=<y>.js', 'src/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/very-deep-path-with-a-long-file-name-for-overflow-testing.js'];
  files.forEach((f, i) => write(dir, f, `// ${HOSTILE[i]}\nexport const x${i} = ${JSON.stringify(HOSTILE[i])};\nexport function f${i}() {\n  return '</script>' + x${i};\n}\n`));
  const long = `${'A very long component label that keeps going '.repeat(40)}END`;
  const ids = ['constructor', 'tostring', 'hasownproperty', 'a..b', `${'x'.repeat(79)}z`.slice(0, 80), 'n0', 'data-node'];
  const evidence = stamp(dir, files.map((file, i) => ({ id: ids[i] ?? `ev-${i}`, file, startLine: 1, endLine: 5, explanation: HOSTILE[i] })));
  const ev = (i) => [evidence[i % evidence.length].id];
  const comps = ids.map((id, i) => ({ id, name: i === 0 ? long : HOSTILE[i % HOSTILE.length], kind: 'module', summary: HOSTILE[(i + 1) % HOSTILE.length], certainty: 'observed', evidence: ev(i) }));
  const relationships = comps.slice(1).map((c, i) => ({ id: `r-${i}`, from: comps[i].id, to: c.id, kind: 'calls', label: HOSTILE[(i + 2) % HOSTILE.length], certainty: 'observed', evidence: ev(i) }));
  relationships.push({ id: 'r-self', from: 'n0', to: 'n0', kind: 'calls', label: 'self', certainty: 'observed', evidence: ev(0) });
  const items = [
    { id: 'imp-0', componentId: ids.at(-1), level: 'high', change: 'modify', reason: HOSTILE[0], certainty: 'observed', evidence: ev(0) },
    { id: 'imp-1', file: files[0], level: 'medium', change: 'modify', reason: HOSTILE[1], certainty: 'observed', evidence: ev(0) },
    { id: 'imp-2', componentId: 'n0', level: 'low', change: 'review', reason: long, certainty: 'observed', evidence: ev(1) },
  ];
  const analysis = {
    ...emptyAnalysis(),
    scope: { summary: HOSTILE.join('\n'), inScope: HOSTILE, outOfScope: [long] },
    files: files.map((p, i) => ({ path: p, role: 'primary', reason: HOSTILE[i], evidence: ev(i) })),
    components: comps, relationships,
    findings: HOSTILE.map((h, i) => ({ id: `f-${i}`, section: 'architecture', title: h, body: `${h}\n${long}`, certainty: 'observed', evidence: ev(i) })),
    impact: { summary: HOSTILE.join(' '), items, relationships: [{ id: 'ir-0', from: 'imp-0', to: 'imp-1', reason: HOSTILE[2], certainty: 'observed', evidence: ev(2) }, { id: 'ir-1', from: 'imp-1', to: 'imp-2', reason: HOSTILE[3], certainty: 'proposed', evidence: [] }] },
    unknowns: [{ id: 'u-0', kind: 'question', statement: HOSTILE[4], reason: long }],
  };
  const visualizations = {
    architecture: [{ id: 'arch-h', title: HOSTILE[0], groups: [{ id: 'g0', label: long }, { id: 'g1', label: HOSTILE[1] }], nodes: comps.map((c, i) => ({ componentId: c.id, group: `g${i % 2}` })), edges: relationships.map((r) => r.id) }],
    executionFlows: [{ id: 'flow-h', title: HOSTILE[2], start: 's0', steps: HOSTILE.slice(0, 5).map((h, i) => ({ id: `s${i}`, label: i === 0 ? long : h, ...(i < 4 ? { next: [{ to: `s${i + 1}`, condition: HOSTILE[(i + 5) % HOSTILE.length] }] } : {}), certainty: 'observed', evidence: ev(i) })) }],
  };
  const sections = [
    { id: 'overview', title: HOSTILE[0], kind: 'overview', origin: 'generated', body: HOSTILE.join('\n') },
    { id: 'architecture', title: HOSTILE[1], kind: 'architecture', origin: 'generated', visualizations: ['arch-h', 'flow-h'] },
    { id: 'implementation', title: 'Files', kind: 'implementation', origin: 'generated' },
    { id: 'impact', title: HOSTILE[2], kind: 'impact', origin: 'generated' },
    { id: 'manual', title: HOSTILE[3], kind: 'custom', origin: 'manual', body: `${HOSTILE.join('\n')}\n${long}` },
    { id: 'unknowns', title: 'Unknowns', kind: 'unknowns', origin: 'generated' },
    { id: 'references', title: 'Evidence', kind: 'references', origin: 'generated' },
    { id: 'history', title: 'History', kind: 'history', origin: 'generated' },
  ];
  return finish(dir, {
    feature: { id: 'hostile', name: `${HOSTILE[0]} ${HOSTILE[1]}`, description: long, mode: 'change-impact', request: HOSTILE.join(' '), proposedChange: HOSTILE[8] },
    repository: { name: HOSTILE[1], branch: 'feature/<b>x</b>' },
    generatedBy: { name: HOSTILE[2], source: 'user-provided' },
    evidence, analysis, visualizations, sections, summary: HOSTILE[0],
  });
}

/** A document with no visualizations and no impact section, only prose and evidence. */
export function noViz(dir) {
  write(dir, 'src/config.js', 'export const config = {\n  retries: 3,\n  timeoutMs: 5000,\n};\n');
  const evidence = stamp(dir, [{ id: 'ev-config', file: 'src/config.js', startLine: 1, endLine: 4, symbol: 'config', kind: 'configuration' }]);
  return finish(dir, {
    feature: { id: 'no-viz', name: 'Retry configuration', description: 'Where retry limits are configured.', mode: 'existing-feature', request: 'Where are retries configured?' },
    repository: { name: 'no-viz' }, evidence,
    analysis: { ...emptyAnalysis(), components: [{ id: 'config', name: 'config', kind: 'config', summary: 'Retry and timeout settings.', certainty: 'observed', evidence: ['ev-config'] }], findings: [{ id: 'f-retries', section: 'overview', title: 'Three retries', body: 'Requests are retried three times.', certainty: 'observed', evidence: ['ev-config'] }] },
    sections: [
      { id: 'overview', title: 'Overview', kind: 'overview', origin: 'generated' },
      { id: 'references', title: 'Evidence', kind: 'references', origin: 'generated' },
      { id: 'history', title: 'History', kind: 'history', origin: 'generated' },
    ],
    summary: 'Created for evaluation.',
  });
}
