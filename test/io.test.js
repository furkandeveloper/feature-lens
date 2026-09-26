import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeDocumentation, OutputError } from '../src/output/writer.js';
import { loadManifestFile, serializeManifest, ManifestLoadError } from '../src/docs/store.js';
import { SAMPLE_MANIFEST, tempDir } from './helpers.js';

describe('writeDocumentation', () => {
  test('writes files under <outputDir>/<featureId>', (t) => {
    const repo = tempDir(t);
    const written = writeDocumentation({ repoRoot: repo, outputDir: 'docs/features', featureId: 'payment-flow' }, [
      { path: 'notes.txt', content: '<h1>hi</h1>' },
      { path: 'assets/app.js', content: '1' },
    ]);
    const base = path.join(fs.realpathSync(repo), 'docs/features/payment-flow');
    assert.deepEqual(written, [path.join(base, 'notes.txt'), path.join(base, 'assets/app.js')]);
    assert.equal(fs.readFileSync(written[0], 'utf8'), '<h1>hi</h1>');
    assert.deepEqual(fs.readdirSync(base).sort(), ['assets', 'notes.txt'], 'no temp files left behind');
  });

  test('refuses index.html and manifest.json, which only writeFeatureDocument writes', (t) => {
    const target = { repoRoot: tempDir(t), outputDir: 'docs', featureId: 'f' };
    for (const p of ['index.html', 'manifest.json']) {
      assert.throws(() => writeDocumentation(target, [{ path: p, content: '' }]), /only by writeFeatureDocument/, p);
    }
  });

  test('refuses paths and ids that would escape the feature folder', (t) => {
    const repo = tempDir(t);
    const target = { repoRoot: repo, outputDir: 'docs', featureId: 'f' };
    for (const p of ['../x.html', '/abs.html', 'a//b', 'a\\b', '', './x']) {
      assert.throws(() => writeDocumentation(target, [{ path: p, content: '' }]), OutputError, p);
    }
    assert.throws(() => writeDocumentation({ ...target, featureId: '../f' }, []), OutputError);
    assert.throws(() => writeDocumentation({ ...target, outputDir: '..' }, []), OutputError);
  });

  test('refuses an output directory that is a symlink out of the repository', (t) => {
    const repo = tempDir(t);
    const outside = tempDir(t);
    fs.symlinkSync(outside, path.join(repo, 'docs'));
    assert.throws(() => writeDocumentation({ repoRoot: repo, outputDir: 'docs', featureId: 'f' }, []), /resolves outside/);
  });

  test('refuses a nested file below a symlink out of the feature folder, writing nothing outside', (t) => {
    const repo = tempDir(t);
    const outside = tempDir(t);
    const target = { repoRoot: repo, outputDir: 'docs', featureId: 'f' };
    writeDocumentation(target, []);
    fs.symlinkSync(outside, path.join(repo, 'docs/f/assets'));
    assert.throws(() => writeDocumentation(target, [{ path: 'assets/deep/app.js', content: '1' }]), /resolves outside/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test('never writes through a symlink planted at the temporary file name', (t) => {
    const repo = tempDir(t);
    const outside = tempDir(t);
    const target = { repoRoot: repo, outputDir: 'docs', featureId: 'f' };
    writeDocumentation(target, []);
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'original');
    fs.symlinkSync(victim, path.join(fs.realpathSync(repo), `docs/f/notes.txt.${process.pid}.tmp`));
    writeDocumentation(target, [{ path: 'notes.txt', content: 'new' }]);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(repo, 'docs/f/notes.txt'), 'utf8'), 'new');
  });
});

describe('manifest store', () => {
  test('round-trips the sample manifest byte for byte', () => {
    const text = fs.readFileSync(SAMPLE_MANIFEST, 'utf8');
    assert.equal(serializeManifest(loadManifestFile(SAMPLE_MANIFEST)), text);
  });

  test('reports unreadable and malformed files', (t) => {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
    assert.throws(() => loadManifestFile(path.join(dir, 'bad.json')), ManifestLoadError);
    assert.throws(() => loadManifestFile(path.join(dir, 'missing.json')), ManifestLoadError);
  });
});
