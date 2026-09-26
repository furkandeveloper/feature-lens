// Static consistency checks for the Claude Code plugin. `claude plugin
// validate .` checks the plugin format itself; it needs the Claude Code CLI,
// so it is not run here. These tests check that the skill's instructions
// match what the CLI and library actually do.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { indexInputs } from '../src/render/inputs.js';
import { DEFAULT_CONFIG } from '../src/config/config.js';
import * as source from '../src/evidence/source.js';
import * as build from '../src/manifest/build.js';
import * as store from '../src/docs/store.js';
import { ROOT, SAMPLE_MANIFEST, sampleManifest, sampleRepoCopy, tempDir } from './helpers.js';

const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
const SKILL = fs.readFileSync(path.join(ROOT, 'skills/featurelens/SKILL.md'), 'utf8');
const CLI_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js"';
const help = spawnSync(process.execPath, [path.join(ROOT, 'bin/featurelens.js'), '--help'], { encoding: 'utf8' }).stdout;

test('plugin metadata is valid JSON with the package name and version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(plugin.name, 'featurelens');
  assert.equal(plugin.version, pkg.version);
  assert.equal(typeof plugin.description, 'string');
});

test('the skill has frontmatter naming it, and every path it references exists', () => {
  const front = SKILL.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, 'frontmatter');
  assert.match(front[1], /^name: featurelens$/m);
  assert.match(front[1], /^description: .{40,}$/m);
  for (const [, p] of SKILL.matchAll(/`((?:src|docs|bin)\/[\w./-]+\.(?:js|md))`/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} exists`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/MANIFEST.md')));
});

test('the skill needs no scripts: every step is a CLI command', () => {
  assert.doesNotMatch(SKILL, /```js\n|\bimport \{/);
  assert.doesNotMatch(SKILL, /\/src\//, 'no library paths to import');
});

test('every CLI command and flag in the skill exists in the CLI usage', () => {
  const commands = [...SKILL.matchAll(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/featurelens\.js" ([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(commands)].sort(), ['build', 'render', 'update', 'validate']);
  for (const c of commands) assert.match(help, new RegExp(`featurelens ${c}\\b`), c);
  // Flags of git commands the skill runs are git's, not the CLI's.
  const withoutGit = SKILL.replace(/git [a-z-]+(?: --[a-z-]+)+/g, '');
  for (const [, flag] of withoutGit.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)) {
    assert.ok(help.includes(flag), `${flag} is a CLI flag`);
  }
  assert.doesNotMatch(SKILL, /--force/, 'the CLI has no --force');
  assert.ok(SKILL.includes(`${CLI_COMMAND} render <scratch>/manifest.json --repo . --excerpts <scratch>/excerpts.json`));
});

test('the skill assigns repository inspection to Claude Code and claims no backend', () => {
  for (const tool of ['Glob', 'Grep', 'Read', 'git log']) assert.ok(SKILL.includes(tool), tool);
  assert.match(SKILL, /FeatureLens does not inspect the repository/);
  assert.match(SKILL, /no analysis engine, no server and no network access/);
  assert.doesNotMatch(SKILL, /MCP|https?:\/\/|api\.github/i);
});

test('the excerpt example in the skill is accepted against the sample manifest', () => {
  const example = JSON.parse(SKILL.match(/## Source excerpts[\s\S]*?```json\n([\s\S]*?)```/)[1]);
  assert.deepEqual(Object.keys(example[0]), ['evidenceId', 'file', 'startLine', 'endLine', 'text']);
  const { excerpts } = indexInputs(sampleManifest(), { excerpts: example, stale: [] });
  assert.equal(excerpts.size, 1);
});

test('output paths, exit codes and stale handling match the CLI', () => {
  assert.ok(SKILL.includes(`defaults to \`${DEFAULT_CONFIG.outputDir}\``));
  assert.match(SKILL, /`<outputDir>\/<feature-id>\/index\.html`/);
  for (const code of ['0', '1', '2', '3']) assert.match(SKILL, new RegExp(`^\\| \`${code}\` \\|`, 'm'), `exit ${code}`);
  assert.match(help, /0 = written and current, 1 = refused/);
  assert.match(SKILL, /--acknowledge` has no effect\s+on evidence that any generated claim\s+cites/);
  assert.match(SKILL, /static impact diagram in generated `impact` sections\s+and every visualization a section lists/);
  assert.match(SKILL, /architecture views, execution\s+flows, sequences, state machines and data flows, each with a legend and a\s+text version/);
  assert.match(SKILL, /Only the impact diagram can be made interactive, and only by selecting a\s+node: there is no pan, zoom, filtering, search or transitive highlighting/);
  assert.match(SKILL, /`render --interactive` makes the impact diagram selectable/);
});

describe('plugin command instructions', () => {
  // Claude Code substitutes the plugin root into the skill text when it loads it.
  const INSTALLED = '/home/me/.claude/plugins/cache/featurelens';
  const loaded = SKILL.split('${CLAUDE_PLUGIN_ROOT}').join(INSTALLED);

  test('commands are literal and copyable, with no shell variable', () => {
    assert.doesNotMatch(SKILL, /\$FL\b/);
    assert.doesNotMatch(SKILL, /^\s*[A-Za-z_][A-Za-z0-9_]*=.*featurelens/m, 'no VAR=... assignment');
    assert.doesNotMatch(SKILL, /\$\{?FL\}?\//);
    assert.ok(SKILL.includes(CLI_COMMAND));
    // Every CLI invocation is the full, quoted command.
    for (const [line] of SKILL.matchAll(/^.*bin\/featurelens\.js.*$/gm)) {
      assert.ok(line.includes(CLI_COMMAND) || line.includes("'${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js'") || line.includes('<base directory>/../../bin/featurelens.js') || /existing `bin\/featurelens\.js`/.test(line), line);
    }
  });

  test('the plugin root placeholder is only used as a path prefix, so the text still reads after substitution', () => {
    const uses = [...SKILL.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}(\S*)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0);
    for (const rest of uses) assert.match(rest, /^\/(?:bin|src|docs)\//, rest);
    // Each prefixed path exists in the plugin layout.
    for (const [, rel] of SKILL.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/((?:bin|src|docs)\/[\w./-]+\.(?:js|md))/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
    }
    assert.doesNotMatch(loaded, new RegExp(`\`${INSTALLED}\`|${INSTALLED}[\`"']?\\s+(?:is|isn't|is not|was)\\b`), 'no sentence about the substituted value itself');
    assert.doesNotMatch(SKILL, /CLAUDE_PLUGIN_ROOT[^/\n]*(?:not set|unset|environment variable|env var)/i);
    assert.doesNotMatch(SKILL, /environment variable/i);
  });

  test('the fallback resolves to the CLI and library in the actual plugin layout', () => {
    const base = path.join(ROOT, 'skills/featurelens');
    assert.ok(fs.existsSync(path.join(base, 'SKILL.md')));
    assert.match(SKILL, /`<base directory>\/\.\.\/\.\.\/bin\/featurelens\.js`/);
    assert.ok(fs.existsSync(path.resolve(base, '../../bin/featurelens.js')));
    assert.ok(fs.existsSync(path.resolve(base, '../../src/manifest/build.js')));
    assert.ok(fs.existsSync(path.resolve(base, '../../.claude-plugin/plugin.json')));
    // The fallback sentence names no substituted value, so it is valid whether or not substitution happened.
    const fallback = loaded.match(/Fallback:[\s\S]*?\n\n/)[0];
    assert.ok(!fallback.includes(INSTALLED), fallback);
  });

  test('the skill does not rely on featurelens being on PATH', () => {
    assert.doesNotMatch(SKILL, /\bPATH\b/);
    assert.doesNotMatch(SKILL, /^\s*featurelens (?:validate|render|git-info)/m);
  });
});

describe('build and update instructions', () => {
  const create = SKILL.slice(SKILL.indexOf('## Creating a document'), SKILL.indexOf('## Source excerpts'));
  const update = SKILL.slice(SKILL.indexOf('## Updating a document'), SKILL.indexOf('## Existing output that is refused'));

  /** The skill's command for `name` in `text`, with its placeholders filled in, as argv. */
  const command = (text, name, fill) => {
    const line = text.split('\n').find((l) => l.includes(`${CLI_COMMAND} ${name} `));
    assert.ok(line, `${name} command`);
    let cmd = line.slice(line.indexOf(CLI_COMMAND) + 'node '.length, line.lastIndexOf('`'));
    for (const [from, to] of fill) cmd = cmd.split(from).join(to);
    return [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  };

  test('existing documents are detected before creating and updated, not reset', () => {
    assert.match(create, /check for an existing document/);
    assert.match(create, /`<outputDir>\/<feature-id>\/manifest\.json`/);
    assert.match(create, /follow "Updating a document" instead/);
    assert.match(create, /`build` refuses a feature id that already has a document/);
    assert.match(create, /history-regression/);
    assert.match(update, /Leave `history`,\s+`metadata\.feature\.id` and every `origin: "manual"` section exactly as\s+they are/);
    assert.match(SKILL, /`history-regression` is different/);
    assert.match(SKILL, /`manual-section-changed` is similar/);
  });

  test('re-stamping is tied to re-reading the code, and manual edits to the user asking', () => {
    assert.match(SKILL, /\*\*remove its `snippetHash`\*\*/);
    assert.match(SKILL, /never do that/);
    assert.match(update, /`--edit-manual <section-id>`: only when the user asked you/);
    assert.match(update, /`manualToReview`/);
    for (const step of ['manifest', 'existing-document', 'evidence', 'validation', 'plan', 'output']) assert.match(update, new RegExp(`\`${step}\``), step);
  });

  test('the draft example has exactly the keys build accepts', () => {
    const example = JSON.parse(create.match(/```json\n([\s\S]*?)```/)[1].replace(/^ {3}/gm, ''));
    assert.deepEqual(Object.keys(example), ['feature', 'evidence', 'analysis', 'visualizations', 'sections', 'summary']);
    assert.equal(example.evidence[0].snippetHash, undefined);
    assert.equal(example.sections[0].provenance, undefined);
  });

  test('the commands run as written: build, render, then validate, update and render after the code moved', (t) => {
    const repo = sampleRepoCopy(t);
    const scratch = tempDir(t);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const run = (argv) => spawnSync(process.execPath, argv, { cwd: repo, encoding: 'utf8', env });
    const fill = [['${CLAUDE_PLUGIN_ROOT}', ROOT], ['<scratch>', scratch]];
    const m = sampleManifest();
    fs.writeFileSync(path.join(scratch, 'draft.json'), JSON.stringify({
      feature: m.metadata.feature, evidence: m.evidence.map(({ snippetHash, ...e }) => e), analysis: m.analysis,
      visualizations: m.visualizations, sections: m.documentation.sections.map(({ provenance, ...x }) => x), summary: 'Created.',
    }));
    fs.writeFileSync(path.join(scratch, 'excerpts.json'), '[]');

    const built = run(command(create, 'build', fill));
    assert.equal(built.status, 0, built.stderr + built.stdout);
    const rendered = run(command(create, 'render', fill));
    assert.equal(rendered.status, 0, rendered.stderr + rendered.stdout);
    const existing = path.join(repo, 'docs/features/payment-flow/manifest.json');

    // The code moved. Steps 1-4 of the update, as the skill writes them.
    const gateway = path.join(repo, 'src/payment/gateway.client.js');
    fs.writeFileSync(gateway, `// moved\n${fs.readFileSync(gateway, 'utf8')}`);
    fs.copyFileSync(existing, path.join(scratch, 'manifest.json'));
    const v = run(command(update, 'validate', fill));
    assert.equal(v.status, 3);
    const revised = JSON.parse(fs.readFileSync(path.join(scratch, 'manifest.json'), 'utf8'));
    for (const x of JSON.parse(v.stdout).stale) Object.assign(revised.evidence.find((e) => e.id === x.evidenceId), x.movedTo);
    fs.writeFileSync(path.join(scratch, 'manifest.json'), store.serializeManifest(revised));
    const u = run(command(update, 'update', [...fill,
      ['"<one sentence: what this update changed>"', '"Relocated the gateway evidence."'],
      ['--changed-file <path> …', '--changed-file src/payment/gateway.client.js']]));
    assert.equal(u.status, 0, u.stderr + u.stdout);

    const updated = JSON.parse(fs.readFileSync(path.join(scratch, 'manifest.json'), 'utf8'));
    assert.deepEqual([updated.history.at(-1).id, updated.history.at(-1).summary], ['h-2', 'Relocated the gateway evidence.']);
    const r = run(command(create, 'render', fill));
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(fs.readFileSync(existing, 'utf8')).history.length, 2);
  });
});
