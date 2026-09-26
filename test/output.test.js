import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MARKER_KEYS, markerLine, hashDocument, stampDocument, readMarker, MarkerError } from '../src/output/marker.js';
import { checkExistingOutput, compareHistory } from '../src/output/existing.js';
import { writeFeatureDocument, writeDocumentation, OutputError, OutputRefusedError } from '../src/output/writer.js';
import { serializeManifest } from '../src/docs/store.js';
import { minimalManifest, sampleManifest, tempDir } from './helpers.js';

const IDENTITY = { featureId: 'empty-feature', schemaVersion: '1.0.0', historyId: 'h-1' };
const BODY = '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Ünïcødé ✓</title></head>\n<body><p>hi</p></body>\n</html>\n';
const HEX = 'a'.repeat(64);

/** Replace the marker line of a stamped document with `line`. */
function withLine2(stamped, line) {
  const lines = stamped.split('\n');
  lines[1] = line;
  return lines.join('\n');
}

/** A manifest at `historyIds.at(-1)`, as the minimal fixture with extra updates. */
function manifestAt(...historyIds) {
  const m = minimalManifest();
  const [first] = m.history;
  m.history = historyIds.map((id) => ({ ...first, id }));
  return m;
}

describe('marker creation', () => {
  test('keys are always in the fixed order, whatever order the input has', () => {
    const line = markerLine({ sha256: HEX, historyId: 'h-1', schemaVersion: '1.0.0', featureId: 'f' });
    assert.equal(line, `<!-- featurelens {"featureId":"f","schemaVersion":"1.0.0","historyId":"h-1","sha256":"${HEX}"} -->`);
    assert.deepEqual(Object.keys(JSON.parse(line.slice('<!-- featurelens '.length, -' -->'.length))), MARKER_KEYS);
  });

  test('refuses missing, extra and malformed fields', () => {
    const good = { ...IDENTITY, sha256: HEX };
    for (const bad of [
      { ...IDENTITY },
      { ...good, extra: 1 },
      { ...good, featureId: 'Bad Id' },
      { ...good, schemaVersion: '1.0' },
      { ...good, historyId: '' },
      { ...good, sha256: HEX.toUpperCase() },
      { ...good, sha256: `sha256:${HEX}` },
    ]) {
      assert.throws(() => markerLine(bad), MarkerError, JSON.stringify(bad));
    }
  });

  test('the marker is placed on line 2, exactly once, and line 1 is unchanged', () => {
    const stamped = stampDocument(BODY, IDENTITY);
    const lines = stamped.split('\n');
    assert.equal(lines[0], '<!doctype html>');
    assert.match(lines[1], /^<!-- featurelens \{.*\} -->$/);
    assert.equal(stamped.split('<!-- featurelens').length - 1, 1);
    assert.equal(lines.slice(2).join('\n'), BODY.slice(BODY.indexOf('\n') + 1));
  });

  test('stamping is deterministic', () => {
    assert.equal(stampDocument(BODY, IDENTITY), stampDocument(BODY, { ...IDENTITY }));
  });

  test('refuses a document without a doctype line or with a marker already in it', () => {
    assert.throws(() => stampDocument('<html></html>', IDENTITY), /doctype/);
    assert.throws(() => stampDocument('<html>\n<!doctype html>\n', IDENTITY), /doctype/);
    assert.throws(() => stampDocument(`${BODY}<!-- featurelens x -->\n`, IDENTITY), /already contains/);
  });
});

describe('marker hash', () => {
  test('round trip: a stamped document reads back with its identity', () => {
    const reading = readMarker(stampDocument(BODY, IDENTITY));
    assert.deepEqual(reading, { ok: true, marker: { ...IDENTITY, sha256: hashDocument(BODY) } });
  });

  test('covers the UTF-8 bytes of the document with the marker line and its newline removed', () => {
    const stamped = stampDocument(BODY, IDENTITY);
    const expected = crypto.createHash('sha256').update(Buffer.from(BODY, 'utf8')).digest('hex');
    assert.equal(readMarker(Buffer.from(stamped, 'utf8')).marker.sha256, expected);
    const [line1, , ...rest] = stamped.split('\n');
    assert.equal([line1, ...rest].join('\n'), BODY, 'removing line 2 gives back the hashed bytes');
  });

  test('the marker line is not part of the hash: changing its other fields keeps the hash', () => {
    const a = readMarker(stampDocument(BODY, IDENTITY)).marker.sha256;
    const b = readMarker(stampDocument(BODY, { ...IDENTITY, historyId: 'h-9' })).marker.sha256;
    assert.equal(a, b);
  });

  test('any change to the rest of the document is a hash mismatch', () => {
    const stamped = stampDocument(BODY, IDENTITY);
    for (const edited of [
      stamped.replace('<p>hi</p>', '<p>hi!</p>'),
      `${stamped}\n`,
      stamped.replace('<!doctype html>', '<!DOCTYPE html>'),
      stamped.replace(/\n/g, '\r\n').replace(/^(<!doctype html>)\r\n(.*?)\r\n/, '$1\n$2\n'),
    ]) {
      assert.equal(readMarker(edited).code, 'hash-mismatch');
    }
  });
});

describe('marker verification', () => {
  const stamped = stampDocument(BODY, IDENTITY);
  const line2 = stamped.split('\n')[1];

  test('missing marker', () => {
    assert.equal(readMarker(BODY).code, 'marker-missing');
    assert.equal(readMarker('').code, 'marker-missing');
  });

  test('marker on the wrong line', () => {
    const lines = stamped.split('\n');
    assert.equal(readMarker([lines[1], lines[0], ...lines.slice(2)].join('\n')).code, 'marker-wrong-line');
    assert.equal(readMarker([lines[0], lines[2], lines[1], ...lines.slice(3)].join('\n')).code, 'marker-wrong-line');
    assert.equal(readMarker(line2).code, 'marker-wrong-line', 'single-line file');
    assert.equal(readMarker(withLine2(stamped, ` ${line2}`)).code, 'marker-wrong-line', 'indented');
  });

  test('duplicate marker, anywhere in the document', () => {
    assert.equal(readMarker(`${stamped}${line2}\n`).code, 'marker-duplicate');
    assert.equal(readMarker(stamped.replace('<p>hi</p>', '<p><!-- featurelens --></p>')).code, 'marker-duplicate');
  });

  test('malformed marker JSON or line format', () => {
    for (const line of [
      '<!-- featurelens {"featureId":"empty-feature" -->',
      '<!-- featurelens not json -->',
      `<!-- featurelens ${line2.slice(17, -4)}-->`,
      `${line2} `,
      `${line2}\r`,
      line2.replace('{"featureId"', '{ "featureId"'),
      '<!-- featurelens',
    ]) {
      assert.equal(readMarker(withLine2(stamped, line)).code, 'marker-malformed', line);
    }
    assert.equal(readMarker(`<!doctype html>\n${line2}`).code, 'marker-malformed', 'no newline after the marker');
    assert.equal(readMarker(stamped.replace('<!doctype html>', '<html>')).code, 'marker-malformed', 'line 1 is not the doctype');
  });

  test('invalid marker fields and key order', () => {
    const json = (o) => `<!-- featurelens ${JSON.stringify(o)} -->`;
    const good = { ...IDENTITY, sha256: HEX };
    for (const fields of [
      [good],
      null,
      'text',
      { ...IDENTITY },
      { ...good, extra: true },
      { sha256: HEX, ...IDENTITY },
      { ...good, featureId: 'UPPER' },
      { ...good, featureId: 7 },
      { ...good, schemaVersion: 'v1' },
      { ...good, historyId: '../h' },
      { ...good, sha256: 'abc' },
      { ...good, sha256: HEX.toUpperCase() },
    ]) {
      assert.equal(readMarker(withLine2(stamped, json(fields))).code, 'marker-invalid', JSON.stringify(fields));
    }
    assert.match(readMarker(withLine2(stamped, json({ sha256: HEX, ...IDENTITY }))).message, /order/);
  });

  test('hash mismatch when the sha256 is well-formed but wrong', () => {
    const wrong = withLine2(stamped, markerLine({ ...IDENTITY, sha256: HEX }));
    assert.equal(readMarker(wrong).code, 'hash-mismatch');
  });
});

describe('checkExistingOutput', () => {
  const target = { featureId: 'empty-feature' };
  const manifestText = (...ids) => serializeManifest(manifestAt(...ids));
  const html = (identity = IDENTITY) => Buffer.from(stampDocument(BODY, identity), 'utf8');
  const check = (h, m) => checkExistingOutput({ html: h, manifest: m }, target);

  test('missing output is safe', () => {
    assert.deepEqual([check(null, null).ok, check(null, null).code], [true, 'absent']);
  });

  test('manifest.json without index.html is safe', () => {
    assert.deepEqual([check(null, manifestText('h-1')).ok, check(null, manifestText('h-1')).code], [true, 'html-absent']);
  });

  test('intact, in-sync output is safe to regenerate', () => {
    const r = check(html(), manifestText('h-1'));
    assert.equal(r.ok, true);
    assert.equal(r.code, 'in-sync');
    assert.equal(r.marker.historyId, 'h-1');
  });

  test('valid hash with a history id mismatch is safe and reported', () => {
    const r = check(html(), manifestText('h-1', 'h-2'));
    assert.equal(r.ok, true);
    assert.equal(r.code, 'history-mismatch');
    assert.deepEqual(r.historyIds, { marker: 'h-1', manifest: 'h-2' });
  });

  test('a history id mismatch with an invalid hash is refused as a hash mismatch', () => {
    const edited = Buffer.from(html().toString('utf8').replace('<p>hi</p>', '<p>edited</p>'), 'utf8');
    const r = check(edited, manifestText('h-1', 'h-2'));
    assert.deepEqual([r.ok, r.code, r.historyIds], [false, 'hash-mismatch', undefined]);
  });

  test('marker problems are refused with their code', () => {
    assert.equal(check(Buffer.from(BODY), manifestText('h-1')).code, 'marker-missing');
    const dup = Buffer.concat([html(), Buffer.from(`${html().toString().split('\n')[1]}\n`)]);
    assert.equal(check(dup, manifestText('h-1')).code, 'marker-duplicate');
    assert.equal(check(dup, manifestText('h-1')).ok, false);
  });

  test('feature id mismatch is refused, in the marker or in manifest.json', () => {
    const other = manifestAt('h-1');
    other.metadata.feature.id = 'other';
    assert.deepEqual([check(null, serializeManifest(other)).ok, check(null, serializeManifest(other)).code], [false, 'feature-id-mismatch']);
    const r = check(html({ ...IDENTITY, featureId: 'other' }), manifestText('h-1'));
    assert.deepEqual([r.ok, r.code], [false, 'feature-id-mismatch']);
  });

  test('schema version mismatch is refused', () => {
    const r = check(html({ ...IDENTITY, schemaVersion: '1.1.0' }), manifestText('h-1'));
    assert.deepEqual([r.ok, r.code], [false, 'schema-version-mismatch']);
  });

  test('index.html without manifest.json is refused, even with a valid marker', () => {
    assert.deepEqual([check(html(), null).ok, check(html(), null).code], [false, 'manifest-missing']);
  });

  test('an unreadable manifest.json is refused', () => {
    for (const text of ['{ nope', '{}', '[]', JSON.stringify({ schemaVersion: '1.0.0', metadata: { feature: { id: 'empty-feature' } }, history: [] })]) {
      assert.deepEqual([check(null, text).ok, check(null, text).code], [false, 'manifest-unreadable'], text);
    }
  });
});

describe('writeFeatureDocument', () => {
  const setup = (t) => {
    const repo = tempDir(t);
    const target = { repoRoot: repo, outputDir: 'docs/features', featureId: 'empty-feature' };
    const dir = path.join(fs.realpathSync(repo), 'docs/features/empty-feature');
    return { target, dir, htmlPath: path.join(dir, 'index.html'), manifestPath: path.join(dir, 'manifest.json') };
  };

  test('writes a stamped index.html and manifest.json into missing output', (t) => {
    const { target, dir, htmlPath, manifestPath } = setup(t);
    const manifest = manifestAt('h-1');
    const result = writeFeatureDocument(target, { manifest, html: BODY });
    assert.deepEqual(result.written, [htmlPath, manifestPath]);
    assert.deepEqual([result.existing.code, result.forced], ['absent', false]);
    assert.equal(fs.readFileSync(htmlPath, 'utf8'), stampDocument(BODY, IDENTITY));
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), serializeManifest(manifest));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['index.html', 'manifest.json'], 'no temp files left behind');
  });

  test('regenerates safe existing output', (t) => {
    const { target, htmlPath } = setup(t);
    writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });
    const result = writeFeatureDocument(target, { manifest: manifestAt('h-1', 'h-2'), html: BODY.replace('hi', 'updated') });
    assert.equal(result.existing.code, 'in-sync');
    const reading = readMarker(fs.readFileSync(htmlPath));
    assert.equal(reading.marker.historyId, 'h-2');
  });

  test('regenerates and reports a valid-hash history mismatch (interrupted write)', (t) => {
    const { target, htmlPath, manifestPath } = setup(t);
    writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });
    // As if a write of h-2 stopped after index.html: HTML at h-2, manifest.json still at h-1.
    fs.writeFileSync(htmlPath, stampDocument(BODY, { ...IDENTITY, historyId: 'h-2' }));
    const result = writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });
    assert.equal(result.existing.code, 'history-mismatch');
    assert.deepEqual(result.existing.historyIds, { marker: 'h-2', manifest: 'h-1' });
    assert.equal(readMarker(fs.readFileSync(htmlPath)).marker.historyId, 'h-1');
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), serializeManifest(manifestAt('h-1')));
  });

  test('refuses to overwrite unsafe output and leaves both files untouched', (t) => {
    const { target, htmlPath, manifestPath } = setup(t);
    writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });
    const edited = fs.readFileSync(htmlPath, 'utf8').replace('<p>hi</p>', '<p>hand edit</p>');
    fs.writeFileSync(htmlPath, edited);
    const manifestBefore = fs.readFileSync(manifestPath, 'utf8');

    assert.throws(
      () => writeFeatureDocument(target, { manifest: manifestAt('h-1', 'h-2'), html: BODY }),
      (e) => e instanceof OutputRefusedError && e.existing.code === 'hash-mismatch',
    );
    assert.equal(fs.readFileSync(htmlPath, 'utf8'), edited);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBefore);

    fs.writeFileSync(htmlPath, '<!doctype html>\n<p>not ours</p>\n');
    assert.throws(() => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY }), /marker-missing/);
    fs.rmSync(manifestPath);
    fs.writeFileSync(htmlPath, stampDocument(BODY, IDENTITY));
    assert.throws(() => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY }), /manifest-missing/);
  });

  test('force replaces unsafe output only when exactly true, and says so', (t) => {
    const { target, htmlPath } = setup(t);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, '<p>unknown</p>');
    for (const force of [1, 'yes', {}]) {
      assert.throws(() => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY }, { force }), OutputRefusedError);
    }
    const result = writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY }, { force: true });
    assert.deepEqual([result.forced, result.existing.code], [true, 'marker-missing']);
    assert.equal(readMarker(fs.readFileSync(htmlPath)).ok, true);
  });

  test('manifest.json is written after index.html: a failed HTML write leaves no manifest', (t) => {
    const { target, htmlPath, manifestPath } = setup(t);
    fs.mkdirSync(`${htmlPath}.${process.pid}.tmp`, { recursive: true });
    assert.throws(() => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY }), OutputError);
    assert.equal(fs.existsSync(htmlPath), false);
    assert.equal(fs.existsSync(manifestPath), false);
  });

  test('manifest.json is written after index.html: modification order', (t) => {
    const { target, htmlPath, manifestPath } = setup(t);
    writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });
    const mtime = (p) => fs.statSync(p, { bigint: true }).mtimeNs;
    assert.ok(mtime(manifestPath) >= mtime(htmlPath));
  });

  test('refuses input it cannot stamp, before touching the disk', (t) => {
    const { target, dir } = setup(t);
    assert.throws(() => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: '<p>no doctype</p>' }), /doctype/);
    const other = manifestAt('h-1');
    other.metadata.feature.id = 'other';
    assert.throws(() => writeFeatureDocument(target, { manifest: other, html: BODY }), /does not match target/);
    assert.equal(fs.existsSync(dir), false);
  });

  test('refuses an existing index.html that is not a regular file', (t) => {
    const { target, htmlPath } = setup(t);
    fs.mkdirSync(htmlPath, { recursive: true });
    assert.throws(() => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY }), /not a regular file/);
  });

  test('adds no external URLs to the document', (t) => {
    const { target, htmlPath } = setup(t);
    writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });
    assert.ok(!/(?:https?|wss?):\/\/|\/\/[a-z]/i.test(fs.readFileSync(htmlPath, 'utf8')));
  });
});

describe('output confinement', () => {
  /** Every path below `dir`, relative and sorted, so tests can compare filesystem state. */
  const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();
  const setup = (t, outputDir = 'docs/features') => {
    const repo = fs.realpathSync(tempDir(t));
    const outside = fs.realpathSync(tempDir(t));
    return { repo, outside, target: { repoRoot: repo, outputDir, featureId: 'empty-feature' } };
  };
  const write = (target) => writeFeatureDocument(target, { manifest: manifestAt('h-1'), html: BODY });

  test('outputDir symlinked outside the repository is refused and nothing is created outside', (t) => {
    const { repo, outside, target } = setup(t, 'docs');
    fs.symlinkSync(outside, path.join(repo, 'docs'));
    assert.throws(() => write(target), (e) => e instanceof OutputError && /resolves outside the repository/.test(e.message));
    assert.deepEqual(tree(outside), [], 'no feature folder was created through the symlink');
  });

  test('a nested missing path below an outside symlink creates no directories outside', (t) => {
    const { repo, outside, target } = setup(t, 'docs/features/nested/deeper');
    fs.symlinkSync(outside, path.join(repo, 'docs'));
    assert.throws(() => write(target), /resolves outside the repository/);
    assert.deepEqual(tree(outside), []);
    assert.deepEqual(tree(repo), ['docs'], 'nothing was created inside the repository either');
  });

  test('a symlink deeper in the path that points outside is refused before mkdir', (t) => {
    const { repo, outside, target } = setup(t, 'docs/features/more');
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.symlinkSync(outside, path.join(repo, 'docs/features'));
    assert.throws(() => write(target), /resolves outside the repository/);
    assert.deepEqual(tree(outside), []);
  });

  test('a symlink to a relative path outside the repository is refused', (t) => {
    const { repo, outside, target } = setup(t, 'docs/x');
    fs.symlinkSync(path.relative(repo, outside), path.join(repo, 'docs'));
    assert.throws(() => write(target), /resolves outside the repository/);
    assert.deepEqual(tree(outside), []);
  });

  test('a dangling symlink in the path is refused without creating its target', (t) => {
    const { repo, outside, target } = setup(t, 'docs/x');
    fs.symlinkSync(path.join(outside, 'not-yet'), path.join(repo, 'docs'));
    assert.throws(() => write(target), /cannot be resolved/);
    assert.deepEqual(tree(outside), []);
  });

  test('a symlinked existing ancestor inside the repository is followed and stays inside', (t) => {
    const { repo, outside, target } = setup(t, 'docs/features');
    fs.mkdirSync(path.join(repo, 'real-docs'));
    fs.symlinkSync(path.join(repo, 'real-docs'), path.join(repo, 'docs'));
    const result = write(target);
    const dir = path.join(repo, 'real-docs/features/empty-feature');
    assert.deepEqual(result.written, [path.join(dir, 'index.html'), path.join(dir, 'manifest.json')]);
    assert.deepEqual(tree(path.join(repo, 'real-docs')), ['features', 'features/empty-feature', 'features/empty-feature/index.html', 'features/empty-feature/manifest.json']);
    assert.deepEqual(tree(outside), []);
  });

  test('a valid nested output path inside the repository is created', (t) => {
    const { repo, outside, target } = setup(t, 'a/b/c/d');
    fs.mkdirSync(path.join(repo, 'a'));
    const result = write(target);
    assert.equal(result.written[0], path.join(repo, 'a/b/c/d/empty-feature/index.html'));
    assert.equal(readMarker(fs.readFileSync(result.written[0])).ok, true);
    assert.deepEqual(tree(outside), []);
  });

  test('an existing path component that is a file is refused', (t) => {
    const { repo, target } = setup(t, 'docs/features');
    fs.writeFileSync(path.join(repo, 'docs'), 'not a directory');
    assert.throws(() => write(target), /exists but is not a directory/);
  });

  test('a symlinked feature folder, index.html or manifest.json pointing outside is refused', (t) => {
    const { repo, outside, target } = setup(t, 'docs');
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.symlinkSync(outside, path.join(repo, 'docs/empty-feature'));
    assert.throws(() => write(target), /resolves outside the repository/);
    fs.rmSync(path.join(repo, 'docs/empty-feature'));

    fs.mkdirSync(path.join(repo, 'docs/empty-feature'));
    for (const name of ['index.html', 'manifest.json']) {
      const link = path.join(repo, 'docs/empty-feature', name);
      fs.writeFileSync(path.join(outside, name), 'outside');
      fs.symlinkSync(path.join(outside, name), link);
      assert.throws(() => write(target), /not a regular file/, name);
      assert.equal(fs.readFileSync(path.join(outside, name), 'utf8'), 'outside', `${name} target untouched`);
      fs.rmSync(link);
    }
  });

  test('absolute and traversal output paths are still refused, creating nothing', (t) => {
    const { repo, target } = setup(t);
    for (const outputDir of ['..', '../x', 'docs/../../x', '/abs', 'a\\..\\..\\x']) {
      assert.throws(() => write({ ...target, outputDir }), /outside the repository/, outputDir);
    }
    assert.throws(() => write({ ...target, outputDir: 'docs/../docs' }), /must not contain/);
    assert.throws(() => writeDocumentation({ ...target, featureId: '../x' }, []), /invalid feature id/);
    assert.deepEqual(tree(repo), []);
  });
});

describe('history regression', () => {
  /** A history entry `id`, distinct in content from any other id. */
  const entry = (id, n) => ({ ...minimalManifest().history[0], id, at: `2026-09-23T1${n}:00:00Z`, ...(n ? { action: 'updated' } : {}) });
  const H1 = entry('h-1', 0);
  const H2 = entry('h-2', 1);
  const H3 = entry('h-3', 2);
  const H4 = entry('h-4', 3);
  const withHistory = (...history) => {
    const m = minimalManifest();
    m.history = structuredClone(history);
    return m;
  };
  const target = { featureId: 'empty-feature' };
  const check = (existing, incoming) => checkExistingOutput(
    { html: null, manifest: serializeManifest(withHistory(...existing)) },
    { ...target, history: structuredClone(incoming) },
  );

  test('identical history is allowed', () => {
    assert.equal(compareHistory([H1, H2], [H1, H2]), null);
    assert.deepEqual([check([H1, H2], [H1, H2]).ok, check([H1, H2], [H1, H2]).code], [true, 'html-absent']);
  });

  test('an append-only extension is allowed', () => {
    assert.equal(compareHistory([H1], [H1, H2, H3]), null);
    assert.equal(check([H1, H2], [H1, H2, H3]).ok, true);
  });

  test('key order inside an entry does not matter', () => {
    const reordered = Object.fromEntries(Object.entries(H2).reverse());
    assert.equal(compareHistory([H1, H2], [H1, reordered]), null);
  });

  const refused = (existing, incoming, reason) => {
    const r = check(existing, incoming);
    assert.deepEqual([r.ok, r.code, r.historyRegression?.reason], [false, 'history-regression', reason]);
    return r;
  };

  test('a removed existing entry is refused', () => {
    const r = refused([H1, H2, H3], [H1, H3, H4], 'removed');
    assert.deepEqual(r.historyRegression, {
      reason: 'removed', existingLength: 3, incomingLength: 3, existingHistoryId: 'h-3', incomingHistoryId: 'h-4', index: 1, entryId: 'h-2',
    });
    assert.match(r.message, /an existing history entry was removed at position 1 \("h-2"\)/);
    refused([H1, H2, H3], [H1, H3], 'removed');
  });

  test('reordered entries are refused', () => {
    refused([H1, H2, H3], [H1, H3, H2], 'reordered');
    refused([H1, H2], [H2, H1, H3], 'reordered');
  });

  test('a modified existing entry is refused', () => {
    const r = refused([H1, H2], [H1, { ...H2, summary: 'Rewritten.' }, H3], 'modified');
    assert.equal(r.historyRegression.entryId, 'h-2');
    refused([H1, H2], [H1, { ...H2, validation: { ...H2.validation, warningCount: 1 } }], 'modified');
  });

  test('an older history rendered over newer output is refused', () => {
    const r = refused([H1, H2, H3], [H1, H2], 'older');
    assert.match(r.message, /older state/);
    assert.deepEqual([r.historyRegression.existingHistoryId, r.historyRegression.incomingHistoryId], ['h-3', 'h-2']);
  });

  test('a new manifest without the existing history is refused', () => {
    const fresh = { ...H1, at: '2026-09-24T08:00:00Z', summary: 'A new analysis.' };
    const r = refused([H1, H2], [fresh], 'replaced');
    assert.match(r.message, /does not contain the existing history/);
    refused([H1], [fresh], 'replaced');
  });

  test('marker, identity and schema checks still run first', () => {
    const other = withHistory(H1);
    other.metadata.feature.id = 'other';
    const r = checkExistingOutput({ html: null, manifest: serializeManifest(other) }, { ...target, history: [H4] });
    assert.equal(r.code, 'feature-id-mismatch');
    const html = Buffer.from(BODY);
    assert.equal(checkExistingOutput({ html, manifest: serializeManifest(withHistory(H1)) }, { ...target, history: [H4] }).code, 'marker-missing');
  });

  describe('writeFeatureDocument', () => {
    const setup = (t) => {
      const repo = tempDir(t);
      const dir = path.join(fs.realpathSync(repo), 'docs/features/empty-feature');
      return { target: { repoRoot: repo, outputDir: 'docs/features', featureId: 'empty-feature' }, htmlPath: path.join(dir, 'index.html'), manifestPath: path.join(dir, 'manifest.json') };
    };

    test('refuses a regressing history and leaves both files untouched', (t) => {
      const { target, htmlPath, manifestPath } = setup(t);
      writeFeatureDocument(target, { manifest: withHistory(H1, H2, H3), html: BODY });
      const before = [fs.readFileSync(htmlPath), fs.readFileSync(manifestPath)];
      for (const history of [[H1, H2], [H1, H3, H2], [H1, H3], [{ ...H1, summary: 'x' }], [H1, { ...H2, summary: 'x' }, H3]]) {
        assert.throws(
          () => writeFeatureDocument(target, { manifest: withHistory(...history), html: BODY }),
          (e) => e instanceof OutputRefusedError && e.existing.code === 'history-regression' && /history-regression/.test(e.message),
          history.map((h) => h.id).join(','),
        );
      }
      assert.deepEqual([fs.readFileSync(htmlPath), fs.readFileSync(manifestPath)], before);
    });

    test('writes identical and appended histories', (t) => {
      const { target, manifestPath } = setup(t);
      writeFeatureDocument(target, { manifest: withHistory(H1), html: BODY });
      assert.equal(writeFeatureDocument(target, { manifest: withHistory(H1), html: BODY }).existing.code, 'in-sync');
      writeFeatureDocument(target, { manifest: withHistory(H1, H2), html: BODY });
      assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).history.length, 2);
    });

    test('force replaces a regressing history, and says so', (t) => {
      const { target } = setup(t);
      writeFeatureDocument(target, { manifest: withHistory(H1, H2), html: BODY });
      const result = writeFeatureDocument(target, { manifest: withHistory(H1), html: BODY }, { force: true });
      assert.deepEqual([result.forced, result.existing.code], [true, 'history-regression']);
    });
  });
});

describe('manual sections', () => {
  // The sample's team-notes section is manual; h-2 wrote it.
  const existing = () => sampleManifest();
  const update = (m, changedSections) => {
    m.history.push({ ...m.history.at(-1), id: 'h-3', at: '2026-09-23T21:00:00.000Z', summary: 'Update.', changedSections });
    for (const s of m.documentation.sections) if (changedSections.includes(s.id)) s.provenance = { historyId: 'h-3' };
    return m;
  };
  const check = (incoming) => checkExistingOutput(
    { html: null, manifest: serializeManifest(existing()) },
    { featureId: 'payment-flow', history: incoming.history, sections: incoming.documentation.sections },
  );
  const notes = (m) => m.documentation.sections.find((s) => s.id === 'team-notes');

  test('a manual section changed or removed without a new history entry for it is refused', () => {
    const edited = existing();
    notes(edited).body = 'Rewritten by an update.';
    const removed = existing();
    removed.documentation.sections = removed.documentation.sections.filter((s) => s.id !== 'team-notes');
    const regenerated = existing();
    notes(regenerated).origin = 'generated';
    const unrecorded = update(existing(), ['overview']);
    notes(unrecorded).body = 'Rewritten by an update.';

    for (const [name, m] of Object.entries({ edited, removed, regenerated, unrecorded })) {
      const r = check(m);
      assert.deepEqual([r.ok, r.code, r.manualSections], [false, 'manual-section-changed', ['team-notes']], name);
      assert.match(r.message, /manual section "team-notes"/, name);
    }
  });

  test('a manual section change recorded in a new history entry is allowed', () => {
    const m = update(existing(), ['team-notes']);
    notes(m).body = 'Edited at the user\'s request.';
    assert.equal(check(m).ok, true);
    const gone = update(existing(), ['team-notes']);
    gone.documentation.sections = gone.documentation.sections.filter((s) => s.id !== 'team-notes');
    assert.equal(check(gone).ok, true);
  });

  test('unchanged manual sections and changed generated sections are not the writer\'s concern', () => {
    assert.equal(check(existing()).ok, true);
    const m = existing();
    m.documentation.sections.find((s) => s.id === 'overview').body = 'New overview.';
    assert.equal(check(m).ok, true);
  });

  test('writeFeatureDocument refuses it and leaves both files untouched', (t) => {
    const repo = tempDir(t);
    const target = { repoRoot: repo, outputDir: 'docs/features', featureId: 'payment-flow' };
    writeFeatureDocument(target, { manifest: existing(), html: BODY });
    const dir = path.join(fs.realpathSync(repo), 'docs/features/payment-flow');
    const before = [fs.readFileSync(path.join(dir, 'index.html')), fs.readFileSync(path.join(dir, 'manifest.json'))];
    const m = existing();
    notes(m).body = 'Silently rewritten.';
    assert.throws(
      () => writeFeatureDocument(target, { manifest: m, html: BODY }),
      (e) => e instanceof OutputRefusedError && e.existing.code === 'manual-section-changed',
    );
    assert.deepEqual([fs.readFileSync(path.join(dir, 'index.html')), fs.readFileSync(path.join(dir, 'manifest.json'))], before);
  });
});
