#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { validateManifest } from '../src/validation/validate.js';
import { checkWriteGate } from '../src/validation/gate.js';
import { loadManifestFile, ManifestLoadError, loadExcerptFile, ExcerptLoadError } from '../src/docs/store.js';
import { render, RenderError, MODES, DEFAULT_MODE } from '../src/render/render.js';
import { indexInputs } from '../src/render/inputs.js';
import { writeFeatureDocument, writeWorkingManifest, OutputError, OutputRefusedError } from '../src/output/writer.js';
import { getRepositoryInfo, getCurrentUser, getContributors } from '../src/git/metadata.js';
import { buildFromDraft, planUpdate, stampEvidence, existingDocument, describeEvidence, WorkflowError } from '../src/manifest/workflow.js';
import { recordUpdate, sectionsCitingEvidence } from '../src/manifest/build.js';
import { loadConfig, ConfigError } from '../src/config/config.js';
import { TOOL_VERSION, SCHEMA_VERSION } from '../src/version.js';

const USAGE = `featurelens ${TOOL_VERSION} (manifest schema ${SCHEMA_VERSION})

Usage:
  featurelens build <draft.json> --repo <dir> --out <manifest.json> [--json]
      Create the manifest for a new document from a draft: { feature,
      evidence, analysis, visualizations?, sections, summary }. Stamps each
      evidence location (refusing lines that don't exist), adds repository
      and people metadata from git, validates, and writes the manifest to
      --out, which must be outside the output directory. Refused when the
      feature already has a document: update it instead.
      Exit code 0 = written, 1 = refused, 2 = usage error.

  featurelens validate <manifest.json> [--repo <dir>] [--json]
      Check a manifest's schema version, structure, references, graphs,
      sections and history, and (with --repo) that every cited file and
      line range exists and still matches. Each stale entry lists the
      claims and the generated and manual sections that show it.
      Exit code 0 = valid and current, 1 = invalid,
      3 = valid but stale (cited code moved, changed or was deleted).
      Invalid takes precedence over stale.

  featurelens update <manifest.json> --repo <dir> --summary <text> --out <file>
                     [--changed-file <path> ...] [--edit-manual <section-id> ...]
                     [--acknowledge <evidence-id> ...] [--json]
      Record an update: compare a revised copy of a feature's existing
      manifest.json with the original in the output directory, stamp
      evidence entries that have no snippetHash, work out which sections
      changed and why, append a history entry at the current git revision,
      validate, apply the write gate, and write the result to --out
      (outside the output directory). Refused when the copy changes the
      history or feature id, or changes, adds or removes a manual section
      not named with --edit-manual (only when the user asked for it).
      --changed-file lists source files changed since the last revision.
      Exit code 0 = written, 1 = refused, 3 = stale: refused, or written
      with acknowledged manual-only stale evidence.

  featurelens render <manifest.json> --repo <dir> --excerpts <file>
                     [--acknowledge <evidence-id> ...] [--mode developer|product]
                     [--interactive] [--json]
      Validate the manifest against the repository, apply the write gate,
      check the excerpts against the manifest, render the HTML and write
      <outputDir>/<feature-id>/index.html, then manifest.json.
      --excerpts is a JSON array of { evidenceId, file, startLine, endLine,
      text } collected by Claude Code ([] for none); render never reads
      source files to fill it in. --acknowledge accepts stale evidence that
      only manual sections cite; it has no effect on any other entry.
      --interactive adds keyboard-accessible node selection to the impact
      diagram: one inline script allowed by its hash in the page's CSP. The
      static diagram and its text version are unchanged; without the flag
      the page has no script. It is not stored: pass it on every render.
      --mode picks the presentation (default developer). developer shows
      implementation detail openly: symbols, file paths, sources and
      certainty on every claim, and code excerpts. product words the same
      claims for readers who need behavior rather than code, and keeps that
      detail in expandable sections. Both show the same claims, certainty
      and evidence; neither adds a script. Not stored: pass it on every render.
      Exit code 0 = written and current, 1 = refused (invalid manifest,
      excerpts or existing output), 3 = stale: refused, or written with
      acknowledged manual-only stale evidence (see "written" in the output).

  featurelens git-info [--repo <dir>] [--files <path> ...]
      Print repository, current user, and contributor metadata as JSON,
      honoring the attribution settings in .featurelens.json.

  featurelens --version
`;

const EXIT = { ok: 0, invalid: 1, usage: 2, stale: 3 };

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: 'string' },
        files: { type: 'string', multiple: true },
        excerpts: { type: 'string' },
        out: { type: 'string' },
        summary: { type: 'string' },
        'changed-file': { type: 'string', multiple: true },
        'edit-manual': { type: 'string', multiple: true },
        acknowledge: { type: 'string', multiple: true },
        interactive: { type: 'boolean', default: false },
        mode: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    return usageError(e.message);
  }

  const { values, positionals } = parsed;
  if (values.version) {
    console.log(TOOL_VERSION);
    return EXIT.ok;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  switch (command) {
    case 'build': return runBuild(rest, values);
    case 'validate': return runValidate(rest, values);
    case 'update': return runUpdate(rest, values);
    case 'render': return runRender(rest, values);
    case 'git-info': return runGitInfo(values);
    default: return usageError(`unknown command "${command}"`);
  }
}

function runValidate([file], { repo, json }) {
  if (!file) return usageError('validate requires a manifest path');

  let manifest;
  try {
    manifest = loadManifestFile(file);
  } catch (e) {
    if (!(e instanceof ManifestLoadError)) throw e;
    console.error(`featurelens: ${e.message}`);
    return EXIT.invalid;
  }

  if (repo && !isDirectory(repo)) return usageError(`--repo is not a directory: ${repo}`);
  const result = validateManifest(manifest, { repoRoot: repo });
  for (const entry of result.stale) entry.sections = sectionsCitingEvidence(manifest, [entry.evidenceId]);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printValidation(result);
    const evidenceNote = repo ? '' : ' (evidence not checked against source; pass --repo)';
    if (!result.valid) console.log(`✗ ${file}: ${result.errors.length} error(s)`);
    else if (result.stale.length > 0) console.log(`! ${file} is valid but stale: ${result.stale.length} evidence reference(s) need updating`);
    else console.log(`✓ ${file} is valid${evidenceNote}`);
  }
  return validationExit(result);
}

/**
 * validate → write gate → excerpts → render → write. Each step refuses on
 * its own; nothing is written unless every step before the writer passed,
 * and success is reported only after the writer returns.
 */
function runRender([file], { repo, excerpts: excerptFile, acknowledge = [], interactive, mode = DEFAULT_MODE, json }) {
  if (!file) return usageError('render requires a manifest path');
  if (!repo) return usageError('render requires --repo <dir>; evidence must be checked against the repository before writing');
  if (!excerptFile) return usageError('render requires --excerpts <file> (a JSON array of source excerpts; [] for none)');
  if (!isDirectory(repo)) return usageError(`--repo is not a directory: ${repo}`);
  if (!MODES.includes(mode)) return usageError(`--mode must be one of ${MODES.join(', ')}, not "${mode}"`);

  /** Everything the run found out, printed once at the end. */
  const out = { written: false, manifest: file, interactive, mode };
  const finish = (exitCode, refusal) => {
    if (refusal) out.refused = refusal;
    if (json) {
      console.log(JSON.stringify({ exitCode, ...out }, null, 2));
    } else {
      if (out.validation) printValidation(out.validation);
      for (const r of out.gate?.reasons ?? []) console.error(`refused [write-gate] ${r}`);
      for (const n of out.notes ?? []) console.error(`note    ${n}`);
      if (refusal) console.log(`✗ ${file}: not written: ${refusal.message}`);
      else console.log(`${exitCode === EXIT.ok ? '✓' : '!'} wrote ${out.output.written.join(', ')}${exitCode === EXIT.ok ? '' : ` (valid but stale: ${out.validation.stale.length} acknowledged manual-only evidence reference(s) shown as unverified)`}`);
    }
    return exitCode;
  };

  let manifest;
  try {
    manifest = loadManifestFile(file);
  } catch (e) {
    if (!(e instanceof ManifestLoadError)) throw e;
    return finish(EXIT.invalid, { step: 'manifest', message: e.message });
  }

  const result = validateManifest(manifest, { repoRoot: repo });
  out.validation = result;
  if (!result.valid) return finish(EXIT.invalid, { step: 'validation', message: `the manifest has ${result.errors.length} validation error(s)` });

  out.notes = [];
  const manualOnly = new Set(result.stale.filter((s) => s.manualOnly).map((s) => s.evidenceId));
  for (const id of acknowledge) {
    if (!manualOnly.has(id)) out.notes.push(`--acknowledge ${id} has no effect: it is not a stale entry that only manual sections cite`);
  }

  // The gate runs before the excerpts are checked: stale evidence is the
  // cause to report (exit 3), and resolving it means collecting new excerpts.
  const gate = checkWriteGate(result, { acknowledged: acknowledge });
  out.gate = { ok: gate.ok, reasons: gate.reasons };
  if (!gate.ok) {
    const exit = result.valid && result.evidenceChecked ? EXIT.stale : EXIT.invalid;
    return finish(exit, { step: 'write-gate', message: `the write gate refused it (${gate.reasons.length} reason(s))` });
  }

  let excerpts;
  let indexed;
  try {
    excerpts = loadExcerptFile(excerptFile);
    indexed = indexInputs(manifest, { excerpts, stale: result.stale });
  } catch (e) {
    if (!(e instanceof ExcerptLoadError || e instanceof RenderError)) throw e;
    return finish(EXIT.invalid, { step: 'excerpts', message: e.message });
  }
  const unexcerpted = manifest.evidence.map((ev) => ev.id).filter((id) => !indexed.excerpts.has(id) && !indexed.stale.has(id));
  out.excerpts = { supplied: indexed.excerpts.size, missing: unexcerpted };
  if (unexcerpted.length > 0) out.notes.push(`no excerpt supplied for ${unexcerpted.join(', ')}; shown as "no excerpt"`);

  let config;
  let html;
  try {
    config = loadConfig(repo);
    html = render(manifest, { excerpts, stale: result.stale }, { interactive, mode });
  } catch (e) {
    if (!(e instanceof ConfigError || e instanceof RenderError)) throw e;
    return finish(EXIT.invalid, { step: e instanceof ConfigError ? 'config' : 'render', message: e.message });
  }

  const target = { repoRoot: repo, outputDir: config.outputDir, featureId: manifest.metadata.feature.id };
  let written;
  try {
    written = writeFeatureDocument(target, { manifest, html });
  } catch (e) {
    if (e instanceof OutputRefusedError) {
      const { code, message, historyRegression, manualSections } = e.existing;
      out.existing = { code, message, ...(historyRegression ? { historyRegression } : {}), ...(manualSections ? { manualSections } : {}) };
      return finish(EXIT.invalid, { step: 'existing-output', code, message: e.message });
    }
    if (e instanceof OutputError) return finish(EXIT.invalid, { step: 'output', message: e.message });
    throw e;
  }
  out.written = true;
  out.output = { written: written.written };
  out.existing = { code: written.existing.code, message: written.existing.message, ...(written.existing.historyIds ? { historyIds: written.existing.historyIds } : {}) };
  if (written.existing.code === 'history-mismatch') out.notes.push(written.existing.message);
  return finish(validationExit(result));
}

/**
 * draft → existing-document check → stamp evidence → git metadata →
 * createManifest → validate → write gate → --out. Writes only --out, and
 * only when every step passed.
 */
function runBuild([file], { repo, out: outFile, json }) {
  if (!file) return usageError('build requires a draft path');
  if (!repo) return usageError('build requires --repo <dir>; evidence is stamped from the repository');
  if (!outFile) return usageError('build requires --out <file> for the manifest (a scratch path outside the output directory)');
  if (!isDirectory(repo)) return usageError(`--repo is not a directory: ${repo}`);

  const out = { written: false, draft: file, out: outFile };
  const finish = (exitCode, refusal) => {
    if (refusal) out.refused = refusal;
    if (json) {
      console.log(JSON.stringify({ exitCode, ...out }, null, 2));
    } else {
      for (const p of refusal?.problems ?? []) console.error(`error   ${p}`);
      if (out.validation) printValidation(out.validation);
      for (const w of out.warnings ?? []) console.error(`warning ${w}`);
      for (const r of out.gate?.reasons ?? []) console.error(`refused [write-gate] ${r}`);
      if (refusal) console.log(`✗ ${file}: not built: ${refusal.message}`);
      else console.log(`✓ built ${outFile}: feature "${out.featureId}", ${out.evidence.total} evidence entr${out.evidence.total === 1 ? 'y' : 'ies'} (${out.evidence.stamped} stamped), ${out.sections.length} section(s). Next: collect excerpts, then render ${outFile}`);
    }
    return exitCode;
  };

  let config;
  let draft;
  try {
    config = loadConfig(repo);
    draft = loadManifestFile(file);
  } catch (e) {
    if (e instanceof ConfigError) return finish(EXIT.invalid, { step: 'config', message: e.message });
    if (e instanceof ManifestLoadError) return finish(EXIT.invalid, { step: 'draft', message: e.message });
    throw e;
  }

  const featureId = draft?.feature?.id;
  if (typeof featureId === 'string') {
    const existing = existingDocument(repo, config.outputDir, featureId);
    if (existing.found) {
      return finish(EXIT.invalid, { step: 'existing-document', message: `feature "${featureId}" already has a document (${existing.path}); update it instead of building a new one` });
    }
    if (existing.error) return finish(EXIT.invalid, { step: 'existing-document', message: existing.error });
  }

  const files = Array.isArray(draft?.evidence) ? [...new Set(draft.evidence.map((e) => e?.file).filter((f) => typeof f === 'string'))] : [];
  const meta = gitMetadata(repo, config.attribution, files);
  let built;
  try {
    built = buildFromDraft(draft, { repoRoot: repo, repository: meta.repository, generatedBy: meta.user, contributors: meta.contributors });
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    return finish(EXIT.invalid, { step: 'draft', message: e.message, problems: e.problems });
  }
  const { manifest, validation, warnings } = built;
  out.validation = validation;
  out.warnings = warnings;
  if (!validation.valid) {
    return finish(EXIT.invalid, { step: 'validation', message: `the manifest has ${validation.errors.length} validation error(s); fix them in the draft (paths point into the manifest: /documentation/sections is the draft's sections, /metadata/feature its feature)` });
  }
  const gate = checkWriteGate(validation);
  out.gate = { ok: gate.ok, reasons: gate.reasons };
  if (!gate.ok) return finish(EXIT.invalid, { step: 'write-gate', message: `the write gate refused it (${gate.reasons.length} reason(s))` });

  try {
    out.path = writeWorkingManifest(outFile, manifest, { repoRoot: repo, outputDir: config.outputDir });
  } catch (e) {
    if (!(e instanceof OutputError)) throw e;
    return finish(EXIT.invalid, { step: 'output', message: e.message });
  }
  out.written = true;
  out.featureId = manifest.metadata.feature.id;
  out.historyId = manifest.history.at(-1).id;
  out.evidence = { total: manifest.evidence.length, stamped: manifest.evidence.length - draft.evidence.filter((e) => e?.snippetHash !== undefined).length };
  out.sections = manifest.documentation.sections.map((x) => x.id);
  return finish(EXIT.ok);
}

/**
 * revised copy → existing manifest.json (from the output directory) →
 * stamp unstamped evidence → validate → planUpdate → recordUpdate at the
 * current revision → write gate → --out. Writes only --out, and only when
 * every step passed; never the output directory.
 */
function runUpdate([file], { repo, out: outFile, summary, 'changed-file': changedFiles = [], 'edit-manual': editManual = [], acknowledge = [], json }) {
  if (!file) return usageError('update requires the path of the revised manifest');
  if (!repo) return usageError('update requires --repo <dir>; evidence must be checked against the repository');
  if (!outFile) return usageError('update requires --out <file> for the updated manifest (a scratch path outside the output directory)');
  if (!summary || !summary.trim()) return usageError('update requires --summary <text>: one sentence saying what this update changed');
  if (!isDirectory(repo)) return usageError(`--repo is not a directory: ${repo}`);

  const out = { written: false, manifest: file, out: outFile };
  const finish = (exitCode, refusal) => {
    if (refusal) out.refused = refusal;
    if (json) {
      console.log(JSON.stringify({ exitCode, ...out }, null, 2));
      return exitCode;
    }
    for (const p of refusal?.problems ?? []) console.error(`error   ${p}`);
    if (out.validation) printValidation(out.validation);
    for (const r of out.gate?.reasons ?? []) console.error(`refused [write-gate] ${r}`);
    for (const e of out.evidence ?? []) console.error(`evidence ${e.id}: ${describeEvidence(e.stale, e.change)}`);
    for (const [id, why] of Object.entries(out.reasons ?? {})) console.error(`section  ${id}: ${why.join('; ')}`);
    for (const id of out.removedSections ?? []) console.error(`removed  section ${id}`);
    for (const r of out.manualToReview ?? []) console.error(`review   manual section ${r.id} was not changed: ${r.reasons.join('; ')}`);
    for (const n of out.notes ?? []) console.error(`note     ${n}`);
    if (refusal) console.log(`✗ ${file}: update not recorded: ${refusal.message}`);
    else console.log(`${exitCode === EXIT.ok ? '✓' : '!'} recorded ${out.historyId} in ${outFile}: ${out.changedSections.length} changed section(s)${exitCode === EXIT.ok ? '' : ' (acknowledged manual-only stale evidence remains)'}. Next: collect excerpts, then render ${outFile}`);
    return exitCode;
  };

  let config;
  let revised;
  try {
    config = loadConfig(repo);
    revised = loadManifestFile(file);
  } catch (e) {
    if (e instanceof ConfigError) return finish(EXIT.invalid, { step: 'config', message: e.message });
    if (e instanceof ManifestLoadError) return finish(EXIT.invalid, { step: 'manifest', message: e.message });
    throw e;
  }

  const featureId = revised?.metadata?.feature?.id;
  if (typeof featureId !== 'string') return finish(EXIT.invalid, { step: 'manifest', message: `${file} has no metadata.feature.id; start from a copy of the feature's manifest.json` });
  const existing = existingDocument(repo, config.outputDir, featureId);
  if (existing.error) return finish(EXIT.invalid, { step: 'existing-document', message: existing.error });
  if (!existing.found) return finish(EXIT.invalid, { step: 'existing-document', message: `feature "${featureId}" has no document (${existing.path}); build one first` });
  let previous;
  try {
    previous = loadManifestFile(existing.real);
  } catch (e) {
    if (!(e instanceof ManifestLoadError)) throw e;
    return finish(EXIT.invalid, { step: 'existing-document', message: e.message });
  }
  const before = validateManifest(previous, { repoRoot: repo });
  if (!before.valid) {
    return finish(EXIT.invalid, { step: 'existing-document', message: `the existing ${existing.path} is invalid (${before.errors.length} error(s): ${before.errors.slice(0, 3).map((x) => `${x.code} at ${x.path}`).join(', ')}); it must be repaired before it can be updated` });
  }

  out.notes = [];
  if (Array.isArray(revised.evidence)) {
    try {
      const stamped = stampEvidence(repo, revised.evidence);
      revised.evidence = stamped.evidence;
      if (stamped.stamped.length > 0) out.notes.push(`stamped ${stamped.stamped.join(', ')} from the current source`);
      out.notes.push(...stamped.warnings);
    } catch (e) {
      if (!(e instanceof WorkflowError)) throw e;
      return finish(EXIT.invalid, { step: 'evidence', message: e.message, problems: e.problems });
    }
  }
  // Provenance is update's to set: a section without one (a new section)
  // gets a placeholder until recordUpdate points it at the new entry.
  const lastId = previous.history.at(-1).id;
  const previousSections = new Map(previous.documentation.sections.map((x) => [x.id, x]));
  for (const sec of Array.isArray(revised.documentation?.sections) ? revised.documentation.sections : []) {
    if (sec && typeof sec === 'object' && sec.provenance === undefined) {
      sec.provenance = structuredClone(previousSections.get(sec.id)?.provenance ?? { historyId: lastId });
    }
  }
  // Only the structure is checked before planning; the full validation
  // runs on the updated manifest, once provenance and history are final.
  const structure = validateManifest(revised);
  if (structure.errors.some((x) => /^(version|schema)\./.test(x.code))) {
    out.validation = structure;
    return finish(EXIT.invalid, { step: 'validation', message: `the revised manifest has ${structure.errors.length} structural error(s)` });
  }

  let plan;
  try {
    plan = planUpdate(previous, revised, { stale: before.stale, editManual });
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    return finish(EXIT.invalid, { step: 'plan', message: e.message, problems: e.problems });
  }
  Object.assign(out, { evidence: plan.evidence, changedSections: plan.changedSections, reasons: plan.reasons, removedSections: plan.removedSections, manualToReview: plan.manualToReview });
  if (plan.changedSections.length === 0) out.notes.push('no section changed; the entry records that the document was checked at this revision');

  const meta = gitMetadata(repo, config.attribution, []);
  if (meta.isGitRepo) refreshRepository(revised.metadata.repository, meta.repository);
  const { manifest, validation } = recordUpdate(revised, {
    revision: meta.repository.revision,
    by: meta.user,
    summary: summary.trim(),
    changedSections: plan.changedSections,
    changedFiles,
    repoRoot: repo,
  });
  out.validation = validation;
  if (!validation.valid) return finish(EXIT.invalid, { step: 'validation', message: `the updated manifest has ${validation.errors.length} validation error(s)` });

  const manualOnly = new Set(validation.stale.filter((x) => x.manualOnly).map((x) => x.evidenceId));
  for (const id of acknowledge) {
    if (!manualOnly.has(id)) out.notes.push(`--acknowledge ${id} has no effect: it is not a stale entry that only manual sections cite`);
  }
  const gate = checkWriteGate(validation, { acknowledged: acknowledge });
  out.gate = { ok: gate.ok, reasons: gate.reasons };
  if (!gate.ok) {
    if (gate.blocking.some((x) => x.status === 'changed' || x.status === 'missing')) {
      out.notes.push('to re-stamp evidence after re-reading the code, set its file and lines and remove its snippetHash; update stamps entries without one');
    }
    return finish(EXIT.stale, { step: 'write-gate', message: `the write gate refused it (${gate.reasons.length} reason(s))` });
  }

  try {
    out.path = writeWorkingManifest(outFile, manifest, { repoRoot: repo, outputDir: config.outputDir });
  } catch (e) {
    if (!(e instanceof OutputError)) throw e;
    return finish(EXIT.invalid, { step: 'output', message: e.message });
  }
  out.written = true;
  out.historyId = manifest.history.at(-1).id;
  return finish(validationExit(validation));
}

/** Repository, person and contributor metadata from git, as a manifest records them. */
function gitMetadata(repo, { includeEmail, includeContributors, maxContributors }, files) {
  const info = getRepositoryInfo(repo);
  const repository = {
    name: info.name,
    ...(info.remoteUrl ? { remoteUrl: info.remoteUrl } : {}),
    ...(info.branch ? { branch: info.branch } : {}),
    ...(info.commit ? { revision: info.commit } : {}),
    ...(info.dirty !== undefined ? { dirty: info.dirty } : {}),
  };
  return {
    isGitRepo: info.isGitRepo,
    repository,
    user: getCurrentUser(repo, { includeEmail }),
    contributors: info.isGitRepo && includeContributors ? getContributors(repo, files, { includeEmail, limit: maxContributors }) : [],
  };
}

/** Bring branch, remote and dirty up to date; the name stays, and recordUpdate sets the revision. */
function refreshRepository(recorded, current) {
  for (const key of ['remoteUrl', 'branch', 'dirty']) {
    if (current[key] === undefined) delete recorded[key];
    else recorded[key] = current[key];
  }
}

function printValidation(result) {
  for (const e of result.errors) console.error(`error   [${e.code}] ${e.path}: ${e.message}`);
  for (const w of result.warnings) console.error(`warning [${w.code}] ${w.path}: ${w.message}`);
  for (const s of result.stale) {
    const who = s.claims.length > 0 ? `; cited by ${s.claims.join(', ')}` : '';
    const manual = s.manualOnly ? ' (manual sections only)' : '';
    const sections = s.sections ? `; sections: ${[...s.sections.generated, ...s.sections.manual.map((id) => `${id} (manual)`)].join(', ') || 'none'}` : '';
    console.error(`stale   [${s.status} → ${s.action}] ${s.path} ${s.evidenceId}: ${s.message}${manual}${who}${sections}`);
  }
}

/** 1 when invalid (wins over stale), 3 when valid but stale, else 0. */
function validationExit(result) {
  if (!result.valid) return EXIT.invalid;
  return result.stale.length > 0 ? EXIT.stale : EXIT.ok;
}

function runGitInfo({ repo = '.', files = [] }) {
  if (!isDirectory(repo)) return usageError(`--repo is not a directory: ${repo}`);

  const repository = getRepositoryInfo(repo);
  let config;
  try {
    config = loadConfig(repository.root);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`featurelens: ${e.message}`);
      return EXIT.invalid;
    }
    throw e;
  }

  const { includeEmail, includeContributors, maxContributors } = config.attribution;
  const contributors = repository.isGitRepo && includeContributors
    ? getContributors(repository.root, files.map(toPosix), { includeEmail, limit: maxContributors })
    : [];

  console.log(JSON.stringify({
    tool: { name: 'featurelens', version: TOOL_VERSION, schemaVersion: SCHEMA_VERSION },
    generatedAt: new Date().toISOString(),
    repository,
    user: getCurrentUser(repository.root, { includeEmail }),
    contributors,
  }, null, 2));
  return EXIT.ok;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function usageError(message) {
  console.error(`featurelens: ${message}\n\n${USAGE}`);
  return EXIT.usage;
}

process.exitCode = main(process.argv.slice(2));
