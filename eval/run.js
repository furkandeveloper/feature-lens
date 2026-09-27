#!/usr/bin/env node
// The evaluation matrix (docs/EVALUATION.md): every case goes through the
// real CLI (validate, then render static and interactive, through the
// writer), with the outcome each step must have, normal and failure paths.
// Also measures validation, diagram model and render times and output
// sizes, and with --browser reviews every written page in headless Chrome.
//
//   node eval/run.js [--out <dir>] [--express <checkout>] [--browser] [--scale] [--json]
//
// --out keeps the repositories, outputs and screenshots (default: a
// temporary directory, removed afterwards). --express adds the Express
// case; it needs a clone of https://github.com/expressjs/express with tags
// 4.19.2, 4.21.2 and v5.0.0 (eval/express.js). --scale adds the large
// synthetic graphs. Exit code: 0 when every expectation held, 1 otherwise,
// 4 when --browser was asked for but no Chrome was found (nothing failed,
// but the browser review did not run).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validateManifest } from '../src/validation/validate.js';
import { impactDiagram, architectureDiagram } from '../src/analysis/diagram-model.js';
import { render } from '../src/render/render.js';
import { recordUpdate } from '../src/manifest/build.js';
import { serializeManifest } from '../src/docs/store.js';
import { readMarker } from '../src/output/marker.js';
import { IMPACT_SCRIPT_HASH } from '../src/render/interactive.js';
import { layeredGraph, manyGroups, hostile, noViz, collectExcerpts } from './fixtures.js';
import { buildExpressManifest, EXPRESS } from './express.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/featurelens.js');
const SAMPLE = path.join(ROOT, 'examples/sample-shop');

const { values: opts } = parseArgs({
  options: {
    out: { type: 'string' }, express: { type: 'string' }, browser: { type: 'boolean', default: false },
    scale: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
  },
});

const work = opts.out ? path.resolve(opts.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'featurelens-eval-'));
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const results = [];
const measurements = [];
/** Pages the browser review opens: { case, file, interactive }. */
const pages = [];
let current = '';

function expect(name, ok, detail = '') {
  results.push({ case: current, name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
}

function log(msg) {
  if (!opts.json) console.error(msg);
}

/** Run the CLI with --json; returns its exit code, parsed output and wall time. */
function cli(args, { json = true } = {}) {
  const t = performance.now();
  const r = spawnSync(process.execPath, [CLI, ...args, ...(json ? ['--json'] : [])], { encoding: 'utf8' });
  const ms = performance.now() - t;
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch { /* not JSON */ }
  return { code: r.status, out, ms, stdout: r.stdout, stderr: r.stderr };
}

function repoCase(name) {
  current = name;
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  log(`· ${name}`);
  return { repo: path.join(dir, 'repo'), scratch: dir };
}

function saveInputs(scratch, manifest, excerpts, suffix = '') {
  const m = path.join(scratch, `manifest${suffix}.json`);
  const x = path.join(scratch, `excerpts${suffix}.json`);
  fs.writeFileSync(m, serializeManifest(manifest));
  fs.writeFileSync(x, JSON.stringify(excerpts));
  return { m, x };
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const outDir = (repo, id, dir = 'docs/features') => path.join(repo, dir, id);
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

/**
 * Per diagram: drawn edges whose line runs through a node box that is not
 * one of its ends (at least 8px inside it), read from the SVG alone. A
 * readability metric for the layout (docs/EVALUATION.md, finding F-5), not
 * a pass/fail check: straight lines are the documented layout today.
 */
function edgesThroughNodes(text) {
  const out = [];
  for (const [, label, body] of text.matchAll(/<svg class="diagram[^"]*"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/svg>/g)) {
    const nodes = [...body.matchAll(/<g class="node[^"]*"[^>]*>\n<title>[^<]*<\/title>\n<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1, 5).map(Number));
    const lines = [...body.matchAll(/<g class="edge[^"]*"[^>]*>\n<title>[\s\S]*?<\/title>\n<path class="line" d="([^"]+)"/g)].map((m) => [...m[1].matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((p) => [+p[1], +p[2]]));
    const inside = (x, y) => nodes.some(([nx, ny, w, h]) => x > nx + 8 && x < nx + w - 8 && y > ny + 8 && y < ny + h - 8);
    const through = lines.filter((pts) => pts.slice(1).some((b, i) => {
      const a = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= len; t += 3) if (inside(a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len)) return true;
      return false;
    })).length;
    if (lines.length) out.push(`${label.split(':')[0]} ${through}/${lines.length}`);
  }
  return out;
}

/** Median wall time of `fn` over `runs` runs, in ms. */
function time(fn, runs = 5) {
  const ts = [];
  let value;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    value = fn();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  return { ms: ts[Math.floor(ts.length / 2)], value };
}

/**
 * Validate, render static, repeat, render interactive, as the skill does,
 * and record measurements. Returns the paths it wrote.
 */
function happyPath(name, repo, scratch, manifest, excerpts, { interactiveExpected = true } = {}) {
  const { m, x } = saveInputs(scratch, manifest, excerpts);
  const id = manifest.metadata.feature.id;
  const v = cli(['validate', m, '--repo', repo]);
  expect('validate exits 0', v.code === 0, `exit ${v.code}: ${JSON.stringify(v.out?.errors ?? v.stderr).slice(0, 400)}`);

  const r1 = cli(['render', m, '--repo', repo, '--excerpts', x]);
  expect('static render exits 0 and writes', r1.code === 0 && r1.out?.written === true, `exit ${r1.code}: ${JSON.stringify(r1.out?.refused ?? r1.stderr).slice(0, 400)}`);
  const html = path.join(outDir(repo, id), 'index.html');
  const staticCopy = path.join(scratch, 'static.html');
  if (!fs.existsSync(html)) return;
  fs.copyFileSync(html, staticCopy);
  const first = sha(html);
  expect('output folder holds exactly index.html and manifest.json', listFiles(outDir(repo, id)).join() === 'index.html,manifest.json', listFiles(outDir(repo, id)).join());
  expect('manifest.json is the input manifest', fs.readFileSync(path.join(outDir(repo, id), 'manifest.json'), 'utf8') === fs.readFileSync(m, 'utf8'));
  const marker = readMarker(fs.readFileSync(html));
  expect('marker valid, history id matches', marker.ok && marker.marker.historyId === manifest.history.at(-1).id);
  const staticText = fs.readFileSync(html, 'utf8');
  expect('static page has no script', !/<script\b/i.test(staticText));

  const r2 = cli(['render', m, '--repo', repo, '--excerpts', x]);
  expect('repeated render exits 0 (in-sync)', r2.code === 0 && r2.out?.existing?.code === 'in-sync', `exit ${r2.code} ${r2.out?.existing?.code}`);
  expect('repeated render is byte-identical', sha(html) === first);

  const r3 = cli(['render', m, '--repo', repo, '--excerpts', x, '--interactive']);
  expect('interactive render exits 0', r3.code === 0 && r3.out?.written === true, `exit ${r3.code}`);
  const interactiveCopy = path.join(scratch, 'interactive.html');
  fs.copyFileSync(html, interactiveCopy);
  const itext = fs.readFileSync(html, 'utf8');
  const scripts = itext.match(/<script\b/gi)?.length ?? 0;
  if (interactiveExpected) {
    expect('interactive page has exactly one script, allowed by hash', scripts === 1 && itext.includes(IMPACT_SCRIPT_HASH.replaceAll("'", '&#39;')));
  } else {
    expect('--interactive without an impact diagram: byte-identical to static', sha(html) === first);
  }
  const r4 = cli(['render', m, '--repo', repo, '--excerpts', x]);
  expect('back to static: byte-identical to the first static render', r4.code === 0 && sha(html) === first);

  // In-process timings, excluding Node startup.
  const again = JSON.parse(fs.readFileSync(m, 'utf8'));
  const tv = time(() => validateManifest(again, { repoRoot: repo }), 3);
  const inputs = { excerpts, stale: tv.value.stale };
  const tm = time(() => impactDiagram(again));
  const archs = again.visualizations.architecture ?? [];
  const ta = time(() => archs.map((view) => architectureDiagram(again, view)));
  const ts = time(() => render(again, inputs), 3);
  const ti = time(() => render(again, inputs, { interactive: true }), 3);
  const im = tm.value;
  measurements.push({
    case: name,
    evidence: again.evidence.length,
    components: again.analysis.components.length,
    relationships: again.analysis.relationships.length,
    impactNodes: im.nodes.length,
    impactEdges: im.edges.length,
    archNodes: ta.value.reduce((n, d) => n + d.nodes.length, 0),
    archEdges: ta.value.reduce((n, d) => n + d.edges.length, 0),
    archGroups: ta.value.reduce((n, d) => n + (d.groups?.length ?? 0), 0),
    validateMs: tv.ms,
    impactModelMs: tm.ms,
    archModelMs: ta.ms,
    renderStaticMs: ts.ms,
    renderInteractiveMs: ti.ms,
    cliStaticMs: r1.ms,
    cliInteractiveMs: r3.ms,
    staticBytes: fs.statSync(staticCopy).size,
    interactiveBytes: fs.statSync(interactiveCopy).size,
    manifestBytes: fs.statSync(m).size,
    edgesThroughNodes: edgesThroughNodes(fs.readFileSync(staticCopy, 'utf8')),
  });
  pages.push({ case: name, file: staticCopy, interactive: false }, { case: name, file: interactiveCopy, interactive: interactiveExpected });
  return { m, x, html };
}

/** A fresh copy of the sample repository with its manifest and real excerpts. */
function sampleCopy(name) {
  const c = repoCase(name);
  fs.cpSync(path.join(SAMPLE, 'src'), path.join(c.repo, 'src'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'featurelens/payment-flow.manifest.json'), 'utf8'));
  return { ...c, manifest, excerpts: collectExcerpts(c.repo, manifest.evidence) };
}

function edit(repo, file, fn) {
  const p = path.join(repo, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')));
}

// ── 1. Small: the sample shop ───────────────────────────────────────────────
{
  const c = sampleCopy('1-small-sample-shop');
  happyPath(current, c.repo, c.scratch, c.manifest, c.excerpts);
}

// ── 2. Medium, real: Express 4.21.2 (optional) ──────────────────────────────
if (opts.express) {
  const c = repoCase('2-medium-express');
  const git = (...a) => execFileSync('git', ['-c', 'advice.detachedHead=false', '-C', c.repo, ...a], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '-q', '--no-hardlinks', path.resolve(opts.express), c.repo]);
  git('checkout', '-q', EXPRESS.tag);
  expect('checkout is the pinned commit', git('rev-parse', 'HEAD') === EXPRESS.commit);
  const { manifest, validation } = buildExpressManifest(c.repo);
  expect('built manifest is valid and current', validation.valid && validation.stale.length === 0 && validation.warnings.length === 0, JSON.stringify(validation.warnings));
  const excerpts = collectExcerpts(c.repo, manifest.evidence);
  const { m, x } = happyPath(current, c.repo, c.scratch, manifest, excerpts);
  // git status must not list anything but the output folder.
  const status = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
  expect('only docs/features/request-routing/ was added to the checkout', status.every((l) => l.startsWith('?? docs/features/request-routing/')), status.join('; '));

  // The same manifest against other tags. 4.19.2 has the same routing code
  // (the cited lines are byte-identical), so the evidence stays current;
  // v5.0.0 moved the router into its own package: real code motion.
  git('checkout', '-q', '4.19.2');
  const same = cli(['validate', m, '--repo', c.repo]);
  measurements.push({ case: `${current} @ 4.19.2`, validateExit: same.code, stale: same.out?.stale?.length, cliValidateMs: same.ms });
  expect('validate at 4.19.2 (same routing code): current, exit 0', same.code === 0 && same.out?.stale?.length === 0, `exit ${same.code}`);
  const sameRender = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
  expect('render at 4.19.2: in-sync, exit 0', sameRender.code === 0 && sameRender.out?.existing?.code === 'in-sync', `exit ${sameRender.code}`);

  git('checkout', '-q', 'v5.0.0');
  const v = cli(['validate', m, '--repo', c.repo]);
  const counts = {};
  for (const s of v.out?.stale ?? []) counts[s.status] = (counts[s.status] ?? 0) + 1;
  measurements.push({ case: `${current} @ v5.0.0`, staleStatuses: counts, validateExit: v.code, cliValidateMs: v.ms });
  expect('validate at v5.0.0 reports stale (exit 3), never invalid', v.code === 3 && v.out?.errors?.length === 0, `exit ${v.code}: ${JSON.stringify(v.out?.errors).slice(0, 400)}`);
  expect('v5.0.0: lib/router/* evidence is missing', (v.out?.stale ?? []).filter((s) => s.file.startsWith('lib/router/')).every((s) => s.status === 'missing'));
  expect('v5.0.0: every stale entry has an action and citing claims', (v.out?.stale ?? []).every((s) => s.action && s.claims.length > 0));
  const out5 = outDir(c.repo, 'request-routing');
  const before = listFiles(out5).map((f) => sha(path.join(out5, f))).join();
  const r = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
  expect('render at v5.0.0 refused by the write gate (exit 3)', r.code === 3 && r.out?.written === false && r.out?.refused?.step === 'write-gate', `exit ${r.code} ${r.out?.refused?.step}`);
  expect('render at v5.0.0 left the existing output untouched', before === listFiles(out5).map((f) => sha(path.join(out5, f))).join());
  const stale5 = path.join(c.scratch, 'validate-v5.txt');
  fs.writeFileSync(stale5, cli(['validate', m, '--repo', c.repo], { json: false }).stderr);
  git('checkout', '-q', EXPRESS.tag);
}

// ── 3. Many architecture groups ─────────────────────────────────────────────
{
  const c = repoCase('3-many-groups');
  const { manifest, excerpts } = manyGroups(c.repo);
  happyPath(current, c.repo, c.scratch, manifest, excerpts);
}

// ── 4. Large impact graphs ──────────────────────────────────────────────────
{
  const sizes = [
    ['4a-layered-6x10', { layers: 6, width: 10, direct: 3 }],
    ['4b-wide-hub-120', { layers: 2, width: 4, direct: 1, hub: 120 }],
    ...(opts.scale ? [
      ['4c-layered-10x40', { layers: 10, width: 40, direct: 6 }],
      ['4d-layered-20x50', { layers: 20, width: 50, direct: 10, fanout: 3 }],
      ['4e-wide-hub-500', { layers: 2, width: 4, direct: 1, hub: 500 }],
    ] : []),
  ];
  for (const [name, o] of sizes) {
    const c = repoCase(name);
    const { manifest, excerpts } = layeredGraph(c.repo, { id: name.replace(/^\w+-/, ''), ...o });
    happyPath(current, c.repo, c.scratch, manifest, excerpts);
  }
}

// ── 5. Stale, missing, moved, ambiguous evidence ────────────────────────────
{
  const staleCase = (name, mutate, expected, { acknowledge } = {}) => {
    const c = sampleCopy(name);
    const { m, x } = saveInputs(c.scratch, c.manifest, c.excerpts);
    const first = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
    expect('baseline render exits 0', first.code === 0);
    const html = path.join(outDir(c.repo, 'payment-flow'), 'index.html');
    const before = sha(html);
    mutate(c.repo);
    const v = cli(['validate', m, '--repo', c.repo]);
    const got = Object.fromEntries((v.out?.stale ?? []).map((s) => [s.evidenceId, `${s.status}/${s.action}`]));
    expect('validate exits 3 (stale, not invalid)', v.code === 3, `exit ${v.code} ${JSON.stringify(v.out?.errors)}`);
    for (const [id, want] of Object.entries(expected)) expect(`${id} is ${want}`, got[id] === want, `got ${got[id]}`);
    expect('every stale entry names its citing claims or manual sections', (v.out?.stale ?? []).every((s) => s.claims.length > 0));
    const r = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
    expect('render refused by the write gate (exit 3)', r.code === 3 && r.out?.written === false && r.out?.refused?.step === 'write-gate', `exit ${r.code}`);
    expect('existing output untouched', sha(html) === before);
    if (acknowledge) {
      const ack = cli(['render', m, '--repo', c.repo, '--excerpts', x, '--acknowledge', acknowledge]);
      expect('--acknowledge on generated-cited evidence has no effect', ack.code === 3 && ack.out?.written === false);
    }
    return { ...c, m, x, html };
  };

  staleCase('5a-moved', (repo) => edit(repo, 'src/payment/gateway.client.js', (s) => `// header added by a refactor\n// second line\n${s}`),
    { 'ev-gateway': 'moved/relocate', 'ev-gateway-url': 'moved/relocate', 'ev-gateway-result': 'moved/relocate' }, { acknowledge: 'ev-gateway' });
  staleCase('5b-changed', (repo) => edit(repo, 'src/payment/payment.service.js', (s) => s.replace("'CARD_DECLINED'", "'PAYMENT_DECLINED'")),
    { 'ev-declined': 'changed/reanalyze', 'ev-pay-order': 'changed/reanalyze' });
  staleCase('5c-missing', (repo) => fs.rmSync(path.join(repo, 'src/orders/order.repository.js')),
    { 'ev-order-find': 'missing/reanalyze', 'ev-order-update': 'missing/reanalyze' });
  staleCase('5d-renamed-file', (repo) => fs.renameSync(path.join(repo, 'src/orders/order.repository.js'), path.join(repo, 'src/orders/orders.repo.js')),
    { 'ev-order-find': 'missing/reanalyze', 'ev-order-update': 'missing/reanalyze' });
  staleCase('5e-ambiguous', (repo) => edit(repo, 'src/payment/payment.service.js', (s) => {
    const lines = s.split('\n');
    const declined = lines[25];
    lines.splice(25, 0, '    // retry once?');
    return [...lines, declined].join('\n');
  }), { 'ev-declined': 'ambiguous/review' });

  // Manual-only stale evidence: only --acknowledge lets it through, and it is still exit 3.
  {
    const c = sampleCopy('5f-manual-only');
    // The sample's manual section cites nothing; give it evidence of its own, stamped as the skill does.
    const { SourceTree, createSourceRef } = await import('../src/evidence/source.js');
    const onlyManual = 'ev-team-notes';
    c.manifest.evidence.push(createSourceRef(new SourceTree(c.repo), { id: onlyManual, file: 'src/payment/gateway.client.js', startLine: 1, endLine: 2, kind: 'comment', explanation: 'The gateway client the team notes refer to.', confidence: 'medium' }).ref);
    c.manifest.documentation.sections.find((s) => s.origin === 'manual').sourceRefs = [onlyManual];
    {
      const ev = c.manifest.evidence.find((e) => e.id === onlyManual);
      edit(c.repo, ev.file, (s) => { const l = s.split('\n'); l[ev.startLine - 1] += ' // edited'; return l.join('\n'); });
      const excerpts = c.excerpts.filter((e) => e.evidenceId !== onlyManual);
      const { m, x } = saveInputs(c.scratch, c.manifest, excerpts);
      const v = cli(['validate', m, '--repo', c.repo]);
      const s = v.out?.stale?.find((e) => e.evidenceId === onlyManual);
      expect('manual-only evidence is stale with action review', v.code === 3 && s?.manualOnly === true && s?.action === 'review', JSON.stringify(s));
      const r = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
      expect('without --acknowledge: refused', r.code === 3 && r.out?.written === false);
      const a = cli(['render', m, '--repo', c.repo, '--excerpts', x, '--acknowledge', onlyManual]);
      expect('with --acknowledge: written, exit 3', a.code === 3 && a.out?.written === true, `exit ${a.code} ${JSON.stringify(a.out?.refused)}`);
      const html = fs.readFileSync(path.join(outDir(c.repo, 'payment-flow'), 'index.html'), 'utf8');
      expect('acknowledged evidence is shown as unverified, without code', html.includes('unverified: changed') && html.includes('The code is not shown because it no longer matches'));
      fs.copyFileSync(path.join(outDir(c.repo, 'payment-flow'), 'index.html'), path.join(c.scratch, 'stale-acknowledged.html'));
      pages.push({ case: current, file: path.join(c.scratch, 'stale-acknowledged.html'), interactive: false });
    }
  }
}

// ── 6. Hostile labels, ids, paths, long text ────────────────────────────────
{
  const c = repoCase('6-hostile');
  const { manifest, excerpts } = hostile(c.repo);
  happyPath(current, c.repo, c.scratch, manifest, excerpts);
  for (const f of ['static.html', 'interactive.html']) {
    const file = path.join(c.scratch, f);
    expect(`${f} was written`, fs.existsSync(file));
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const body = text.replace(/<script>[\s\S]*?<\/script>/, '');
    expect(`${f}: no raw hostile tag or event-handler attribute`, !/<img|<svg onload|<script>alert/i.test(body) && !/<[a-z][a-z0-9-]*(?:\s+[a-z:-]+(?:="[^"]*")?)*\s+on[a-z]+\s*=/i.test(body));
    expect(`${f}: only one marker comment`, (text.match(/<!-- featurelens /g) ?? []).length === 1);
    expect(`${f}: no external URL`, !/(?:src|href)="(?:https?:|\/\/|javascript:)/i.test(text));
  }
}

// ── 7. No visualizations ────────────────────────────────────────────────────
{
  const c = repoCase('7-no-visualizations');
  const { manifest, excerpts } = noViz(c.repo);
  happyPath(current, c.repo, c.scratch, manifest, excerpts, { interactiveExpected: false });
}

// ── Failure paths on the sample ─────────────────────────────────────────────
{
  const c = sampleCopy('9-failures');
  const { m, x } = saveInputs(c.scratch, c.manifest, c.excerpts);
  const write = (name, value) => {
    const p = path.join(c.scratch, name);
    fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
    return p;
  };
  const nothingWritten = () => !fs.existsSync(path.join(c.repo, 'docs'));
  const refused = (label, args, code, step) => {
    const r = cli(args);
    expect(`${label}: exit ${code}${step ? `, step ${step}` : ''}`, r.code === code && (!step || r.out?.refused?.step === step), `exit ${r.code} step ${r.out?.refused?.step}: ${(r.out?.refused?.message ?? r.stderr).slice(0, 300)}`);
    return r;
  };

  refused('manifest is not JSON', ['render', write('bad.json', '{ "schemaVersion": '), '--repo', c.repo, '--excerpts', x], 1, 'manifest');
  refused('manifest file missing', ['render', path.join(c.scratch, 'nope.json'), '--repo', c.repo, '--excerpts', x], 1, 'manifest');
  const noVersion = structuredClone(c.manifest); delete noVersion.schemaVersion;
  refused('schema violation', ['render', write('schema.json', noVersion), '--repo', c.repo, '--excerpts', x], 1, 'validation');
  const future = structuredClone(c.manifest); future.schemaVersion = '2.0.0';
  refused('unsupported schema version', ['render', write('future.json', future), '--repo', c.repo, '--excerpts', x], 1, 'validation');
  const unknownEv = structuredClone(c.manifest); unknownEv.analysis.components[0].evidence = ['ev-does-not-exist'];
  const u = refused('claim cites an unknown evidence id', ['render', write('unknown-ev.json', unknownEv), '--repo', c.repo, '--excerpts', x], 1, 'validation');
  expect('unknown evidence id is reported as ref.unknown at its pointer', (u.out?.validation?.errors ?? []).some((e) => e.code === 'ref.unknown' && e.path === '/analysis/components/0/evidence/0'), JSON.stringify(u.out?.validation?.errors));
  const vizUnknown = structuredClone(c.manifest); vizUnknown.visualizations.architecture[0].nodes.push({ componentId: 'ghost' });
  refused('visualization names an unknown component', ['render', write('viz.json', vizUnknown), '--repo', c.repo, '--excerpts', x], 1, 'validation');
  const escapePath = structuredClone(c.manifest); escapePath.evidence[0].file = '../../../etc/passwd';
  refused('evidence path escapes the repository', ['render', write('escape.json', escapePath), '--repo', c.repo, '--excerpts', x], 1, 'validation');
  fs.symlinkSync('/etc/hosts', path.join(c.repo, 'src/link-out.js'));
  const symEv = structuredClone(c.manifest); symEv.evidence[0].file = 'src/link-out.js';
  refused('evidence file is a symlink out of the repository', ['render', write('symev.json', symEv), '--repo', c.repo, '--excerpts', x], 1, 'validation');
  fs.rmSync(path.join(c.repo, 'src/link-out.js'));

  const badText = structuredClone(c.excerpts); badText[0].text += ' ';
  refused('excerpt text does not match its hash', ['render', m, '--repo', c.repo, '--excerpts', write('x-text.json', badText)], 1, 'excerpts');
  refused('excerpt for an unknown evidence id', ['render', m, '--repo', c.repo, '--excerpts', write('x-id.json', [...c.excerpts, { ...c.excerpts[0], evidenceId: 'ev-nope' }])], 1, 'excerpts');
  refused('excerpt file not an array', ['render', m, '--repo', c.repo, '--excerpts', write('x-obj.json', {})], 1, 'excerpts');
  refused('missing --excerpts', ['render', m, '--repo', c.repo], 2);
  refused('missing --repo', ['render', m, '--excerpts', x], 2);
  refused('--repo is not a directory', ['render', m, '--repo', path.join(c.repo, 'nope'), '--excerpts', x], 2);
  expect('no failure above wrote anything', nothingWritten());

  // Output directory: invalid values and symlinks.
  const outside = path.join(work, 'outside-target');
  fs.mkdirSync(outside, { recursive: true });
  const cfg = (value) => fs.writeFileSync(path.join(c.repo, '.featurelens.json'), JSON.stringify({ outputDir: value }));
  for (const [label, value, step] of [['outputDir ../escape', '../escape', 'config'], ['absolute outputDir', outside, 'config'], ['outputDir docs/../..', 'docs/../..', 'config'], ['outputDir with backslash', 'docs\\x', 'config'], ['outputDir "."', '.', null]]) {
    cfg(value);
    const r = refused(label, ['render', m, '--repo', c.repo, '--excerpts', x], value === '.' ? 0 : 1, step);
    if (value === '.') {
      expect('outputDir "." writes <repo>/<feature-id>/', fs.existsSync(path.join(c.repo, 'payment-flow/index.html')), JSON.stringify(r.out?.refused));
      fs.rmSync(path.join(c.repo, 'payment-flow'), { recursive: true, force: true });
    }
  }
  fs.writeFileSync(path.join(c.repo, '.featurelens.json'), '{ not json');
  refused('.featurelens.json is not JSON', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'config');
  fs.rmSync(path.join(c.repo, '.featurelens.json'));
  fs.mkdirSync(path.join(c.repo, '.featurelens.json'));
  const dirCfg = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
  expect('.featurelens.json is a directory: refused with exit 1 and a message, not a crash', dirCfg.code === 1 && dirCfg.out?.refused?.step === 'config', `exit ${dirCfg.code}; stdout ${dirCfg.stdout.slice(0, 120)}; stderr ${dirCfg.stderr.split('\n')[0]}`);
  fs.rmSync(path.join(c.repo, '.featurelens.json'), { recursive: true });

  fs.symlinkSync(outside, path.join(c.repo, 'docs'));
  refused('docs/ is a symlink out of the repository', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'output');
  fs.rmSync(path.join(c.repo, 'docs'));
  fs.mkdirSync(path.join(c.repo, 'docs/features'), { recursive: true });
  fs.symlinkSync(outside, path.join(c.repo, 'docs/features/payment-flow'));
  refused('feature folder is a symlink out of the repository', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'output');
  fs.rmSync(path.join(c.repo, 'docs/features/payment-flow'));
  fs.writeFileSync(path.join(c.repo, 'docs/features/payment-flow'), 'a file');
  refused('feature folder path is a file', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'output');
  fs.rmSync(path.join(c.repo, 'docs/features/payment-flow'));
  expect('nothing was written outside the repository', listFiles(outside).length === 0, listFiles(outside).join());

  fs.mkdirSync(path.join(c.repo, 'internal-docs'));
  fs.rmSync(path.join(c.repo, 'docs'), { recursive: true });
  fs.symlinkSync(path.join(c.repo, 'internal-docs'), path.join(c.repo, 'docs'));
  const inside = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
  expect('docs/ symlinked inside the repository: written there', inside.code === 0 && fs.existsSync(path.join(c.repo, 'internal-docs/features/payment-flow/index.html')));
  fs.rmSync(path.join(c.repo, 'docs'));
  fs.rmSync(path.join(c.repo, 'internal-docs'), { recursive: true });

  // index.html as a symlink to a file outside: refused, target untouched.
  const victim = path.join(outside, 'victim.html');
  fs.writeFileSync(victim, 'keep me');
  fs.mkdirSync(outDir(c.repo, 'payment-flow'), { recursive: true });
  fs.symlinkSync(victim, path.join(outDir(c.repo, 'payment-flow'), 'index.html'));
  refused('index.html is a symlink to a file outside', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'output');
  expect('symlink target untouched', fs.readFileSync(victim, 'utf8') === 'keep me');
  fs.rmSync(outDir(c.repo, 'payment-flow'), { recursive: true });
  fs.rmSync(victim);

  // Existing output with markers.
  const ok = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
  expect('clean render exits 0', ok.code === 0);
  const html = path.join(outDir(c.repo, 'payment-flow'), 'index.html');
  const good = fs.readFileSync(html);
  fs.writeFileSync(html, good.toString().replace('<h1>', '<h1>Edited '));
  const edited = refused('hand-edited index.html', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'existing-output');
  expect('reported as hash-mismatch', edited.out?.existing?.code === 'hash-mismatch', edited.out?.existing?.code);
  expect('hand-edited file kept as is', fs.readFileSync(html, 'utf8').includes('<h1>Edited '));
  fs.writeFileSync(html, '<!doctype html>\n<p>hand written</p>\n');
  refused('unmarked index.html', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'existing-output');
  fs.writeFileSync(html, good);
  fs.rmSync(path.join(outDir(c.repo, 'payment-flow'), 'manifest.json'));
  refused('index.html without manifest.json', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'existing-output');
  fs.rmSync(outDir(c.repo, 'payment-flow'), { recursive: true });

  // Another feature's folder under this id.
  const other = structuredClone(c.manifest); other.metadata.feature.id = 'other-feature';
  const om = write('other.json', other);
  cli(['render', om, '--repo', c.repo, '--excerpts', x]);
  fs.renameSync(outDir(c.repo, 'other-feature'), outDir(c.repo, 'payment-flow'));
  refused("another feature's folder", ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'existing-output');
  fs.rmSync(outDir(c.repo, 'payment-flow'), { recursive: true });

  // History: an update extends it; the older manifest is then refused.
  const base = cli(['render', m, '--repo', c.repo, '--excerpts', x]);
  expect('base render exits 0', base.code === 0);
  const { manifest: updated, validation } = recordUpdate(c.manifest, { by: { source: 'unknown' }, summary: 'Evaluation update.', changedSections: ['overview'], now: new Date('2026-09-24T13:00:00.000Z'), repoRoot: c.repo });
  expect('recordUpdate result valid', validation.valid && validation.stale.length === 0);
  const um = write('updated.json', JSON.parse(serializeManifest(updated)));
  const up = cli(['render', um, '--repo', c.repo, '--excerpts', x]);
  expect('updated manifest renders (history extends)', up.code === 0, JSON.stringify(up.out?.refused));
  const reg = refused('older manifest after an update', ['render', m, '--repo', c.repo, '--excerpts', x], 1, 'existing-output');
  expect('reported as history-regression / older', reg.out?.existing?.code === 'history-regression' && reg.out?.existing?.historyRegression?.reason === 'older', JSON.stringify(reg.out?.existing));
  const fresh = structuredClone(c.manifest); fresh.history[0].summary = 'A different first entry.';
  const rep = refused('a new document over an existing one', ['render', write('replaced.json', fresh), '--repo', c.repo, '--excerpts', x], 1, 'existing-output');
  expect('reported as history-regression', rep.out?.existing?.code === 'history-regression', rep.out?.existing?.historyRegression?.reason);
  const again = cli(['render', um, '--repo', c.repo, '--excerpts', x]);
  expect('updated manifest still renders afterwards', again.code === 0);
}

// ── Stale detection cost in a large file ────────────────────────────────────
{
  const c = repoCase('8-stale-large-file');
  const lines = Array.from({ length: 20000 }, (_, i) => `  const v${i} = compute(${i}); // line ${i + 1}`);
  fs.mkdirSync(path.join(c.repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(c.repo, 'src/big.js'), `${lines.join('\n')}\n`);
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/minimal.manifest.json'), 'utf8'));
  const { SourceTree, createSourceRef } = await import('../src/evidence/source.js');
  const tree = new SourceTree(c.repo);
  base.evidence = Array.from({ length: 100 }, (_, i) => createSourceRef(tree, { id: `ev-${i}`, file: 'src/big.js', startLine: i * 150 + 1, endLine: i * 150 + 40, kind: 'logic', explanation: 'x', confidence: 'high' }).ref);
  base.analysis.files = [{ path: 'src/big.js', role: 'primary', reason: 'x', evidence: base.evidence.map((e) => e.id) }];
  // Every cited block changes: the worst case, a full scan per entry.
  fs.writeFileSync(path.join(c.repo, 'src/big.js'), `${lines.map((l) => l.replace('compute', 'calc')).join('\n')}\n`);
  const t = time(() => validateManifest(base, { repoRoot: c.repo }), 1);
  expect('100 changed 40-line entries in a 20,000-line file: all stale', t.value.stale.length === 100 && t.value.stale.every((s) => s.status === 'changed'));
  measurements.push({ case: current, evidence: 100, fileLines: 20000, validateMs: t.ms });
}

// ── Browser review ──────────────────────────────────────────────────────────
let browser = { ran: false };
if (opts.browser) {
  const { findChrome, launch } = await import('../test/chrome.js');
  const chrome = findChrome();
  if (!chrome) {
    browser = { ran: false, reason: 'no Chrome or Chromium found (set CHROME_PATH)' };
  } else {
    browser = { ran: true, chrome, pages: [] };
    const shots = path.join(work, 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    const b = await launch(chrome);
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__dialogs = 0; window.alert = window.confirm = window.prompt = () => { window.__dialogs++; };' });
    try {
      for (const p of pages) {
        current = p.case;
        const html = fs.readFileSync(p.file, 'utf8');
        for (const width of [390, 1280]) {
          for (const dark of [false, true]) {
            const t = performance.now();
            await b.open(html, { width, dark });
            const loadMs = performance.now() - t;
            const tag = `${path.basename(p.file, '.html')} ${width}px ${dark ? 'dark' : 'light'}`;
            const s = await b.eval(`(() => {
              const de = document.documentElement;
              const scrolls = [...document.querySelectorAll('.diagram-scroll')];
              const overflowing = [...document.querySelectorAll('body *')].filter((e) => {
                const r = e.getBoundingClientRect();
                return r.right > de.clientWidth + 1 && !e.closest('.diagram-scroll, .table-scroll, pre');
              }).map((e) => e.tagName + '.' + e.className).slice(0, 5);
              return {
                pageOverflow: de.scrollWidth - de.clientWidth,
                overflowing,
                scripts: document.scripts.length,
                handlers: document.querySelectorAll('[onerror],[onload],[onclick],[onmouseover]').length,
                images: document.images.length,
                diagrams: document.querySelectorAll('svg.diagram').length,
                wide: document.querySelectorAll('svg.diagram.wide').length,
                internalScroll: scrolls.filter((d) => d.scrollWidth > d.clientWidth + 1).length,
                widestSvg: Math.max(0, ...[...document.querySelectorAll('svg.diagram')].map((x) => +x.getAttribute('width'))),
                csp: window.__cspViolations.length,
                dialogs: window.__dialogs,
                bg: getComputedStyle(document.body).backgroundColor,
                nodes: document.querySelectorAll('.impact-graph g.node[tabindex]').length,
                height: de.scrollHeight,
              };
            })()`);
            expect(`${tag}: no page-level horizontal overflow`, s.pageOverflow <= 0, `${s.pageOverflow}px: ${s.overflowing.join(', ')}`);
            expect(`${tag}: no CSP violation, dialog or inline handler`, s.csp === 0 && s.dialogs === 0 && s.handlers === 0 && s.images === 0, JSON.stringify(s));
            expect(`${tag}: ${p.interactive ? 'one script, enhanced' : 'no script'}`, p.interactive ? s.scripts === 1 && s.nodes > 0 : s.scripts === 0 && s.nodes === 0, JSON.stringify(s));
            const entry = { case: p.case, page: tag, loadMs, ...s };
            if (p.interactive) {
              // The impact diagram is on its section's page: open it by its hash, as a reader would.
              await b.eval(`location.hash = document.querySelector('div.impact-graph').closest('section').id`);
              // Select the busiest node by click, then Escape; time the handler in the page.
              const sel = await b.eval(`(() => {
                const root = document.querySelector('div.impact-graph');
                const nodes = [...root.querySelectorAll('g.node[data-node]')];
                const degree = (n) => root.querySelectorAll('g.edge[data-source="' + n + '"], g.edge[data-target="' + n + '"]').length;
                const g = nodes.reduce((a, x) => (degree(x.dataset.node) > degree(a.dataset.node) ? x : a));
                const t = performance.now();
                g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                const ms = performance.now() - t;
                g.focus();
                return { ms, node: g.dataset.node, degree: degree(g.dataset.node), panel: !root.querySelector('.impact-details').hidden, status: root.querySelector('.impact-status').textContent, reset: !root.querySelector('.impact-reset').disabled, focused: document.activeElement === g };
              })()`);
              expect(`${tag}: selection shows the details panel and enables reset`, sel.panel && sel.reset && sel.status.startsWith('Selected '), JSON.stringify(sel));
              entry.selectMs = sel.ms;
              entry.selectDegree = sel.degree;
              if (width === 1280 && !dark) {
                await b.eval(`document.querySelector('.impact-details').scrollIntoView({ block: 'end' })`);
                await b.screenshot(path.join(shots, `${p.case}--selected-${width}.png`));
              }
              await b.key('Escape');
              const after = await b.eval(`(() => { const root = document.querySelector('div.impact-graph'); return { hidden: root.querySelector('.impact-details').hidden, sel: root.classList.contains('has-selection'), focus: document.activeElement?.dataset?.node ?? null }; })()`);
              expect(`${tag}: Escape clears the selection and keeps focus on the node`, after.hidden && !after.sel && after.focus === sel.node, JSON.stringify(after));
            }
            await b.eval(`location.hash = ''; window.scrollTo(0, 0)`);
            await b.screenshot(path.join(shots, `${p.case}--${path.basename(p.file, '.html')}-${width}-${dark ? 'dark' : 'light'}.png`));
            const first = await b.eval(`(() => { const f = document.querySelector('figure.viz, div.impact-graph, .diagram-scroll'); if (!f) return false; const s = f.closest('section[id]'); if (s) location.hash = s.id; f.scrollIntoView({ block: 'start' }); return true; })()`);
            if (first) await b.screenshot(path.join(shots, `${p.case}--${path.basename(p.file, '.html')}-${width}-${dark ? 'dark' : 'light'}-diagram.png`));
            browser.pages.push(entry);
          }
        }
      }
    } finally {
      await b.close();
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const report = { work, results: { total: results.length, passed: results.length - failed.length, failed }, measurements, browser };
if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n${results.length - failed.length}/${results.length} expectations held`);
  for (const f of failed) console.log(`✗ [${f.case}] ${f.name}: ${f.detail}`);
  console.log('\nMeasurements (ms are medians, in-process unless "cli")');
  for (const m of measurements) console.log(JSON.stringify(m));
  if (opts.browser) {
    if (!browser.ran) console.log(`\nBrowser review NOT RUN: ${browser.reason}`);
    else {
      console.log(`\nBrowser review: ${browser.pages.length} page loads with ${browser.chrome}`);
      for (const p of browser.pages) console.log(JSON.stringify({ case: p.case, page: p.page, loadMs: Math.round(p.loadMs), pageOverflow: p.pageOverflow, wide: p.wide, internalScroll: p.internalScroll, widestSvg: p.widestSvg, height: p.height, ...(p.selectMs !== undefined ? { selectMs: +p.selectMs.toFixed(2), degree: p.selectDegree } : {}) }));
    }
  }
  console.log(`\nOutputs in ${work}${opts.out ? '' : ' (removed)'}`);
}
if (!opts.out) fs.rmSync(work, { recursive: true, force: true });
process.exitCode = failed.length ? 1 : opts.browser && !browser.ran ? 4 : 0;
