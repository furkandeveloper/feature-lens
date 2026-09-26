// Checks the manifest against the files in the repository. Two kinds of
// result come out of it:
//
// - errors: the manifest cannot be trusted as written (a path that escapes
//   the repository, a file listed without evidence that does not exist).
// - stale entries: evidence that was true when it was stamped, but the
//   repository has moved on since. The manifest is still well-formed; the
//   document needs an update. Staleness is never downgraded to a warning.

import { SourceTree, hashSnippet, findSnippet } from '../evidence/source.js';

/**
 * - `moved`: the cited lines are unchanged but sit elsewhere in the same file (`movedTo`).
 * - `changed`: the cited lines no longer exist anywhere in the file.
 * - `missing`: the file was deleted or is no longer a regular file.
 * - `ambiguous`: the cited lines appear more than once (`candidates`).
 * @typedef {'moved' | 'changed' | 'missing' | 'ambiguous'} StaleStatus
 */

/**
 * What resolving a stale entry takes:
 * - `relocate`: update the line numbers to `movedTo`; the cited text is identical.
 * - `reanalyze`: Claude re-reads the code and revises the claims.
 * - `review`: a person decides (ambiguous match, or evidence only manual sections use).
 * @typedef {'relocate' | 'reanalyze' | 'review'} StaleAction
 */

/**
 * @typedef {object} StaleEntry
 * @property {string} evidenceId
 * @property {string} path JSON Pointer of the evidence entry
 * @property {string} file
 * @property {StaleStatus} status
 * @property {StaleAction} action
 * @property {{ startLine: number, endLine: number }} [movedTo] when status is `moved`
 * @property {{ startLine: number, endLine: number }[]} [candidates] when status is `ambiguous`
 * @property {string[]} claims JSON Pointers of the claims and sections citing this evidence
 * @property {string[]} manualSections ids of manual sections whose `sourceRefs` list this evidence
 * @property {boolean} manualOnly only manual sections' `sourceRefs` cite it (no generated claim does); never rewrite automatically
 * @property {string} message
 */

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {string} repoRoot
 * @param {import('./report.js').Report} report
 * @param {import('./semantic.js').Citations} citations
 * @returns {StaleEntry[]}
 */
export function checkAgainstRepository(manifest, repoRoot, report, citations) {
  const tree = new SourceTree(repoRoot);
  const manualIds = new Set(manifest.documentation.sections.filter((s) => s.origin === 'manual').map((s) => s.id));
  /** @type {StaleEntry[]} */
  const stale = [];

  manifest.evidence.forEach((ev, i) => {
    const p = `/evidence/${i}`;
    if (ev.endLine < ev.startLine) return; // already reported as evidence.range
    const at = `${ev.file}:${ev.startLine}-${ev.endLine}`;
    const lines = tree.lines(ev.file);

    const found = (status, message, extra = {}) => {
      const cites = citations.get(ev.id) ?? [];
      const manualSections = [...new Set(cites.map((c) => c.section).filter((s) => manualIds.has(s)))];
      const manualOnly = cites.length > 0 && cites.every((c) => manualIds.has(c.section));
      const action = manualOnly || status === 'ambiguous' ? 'review' : status === 'moved' ? 'relocate' : 'reanalyze';
      stale.push({
        evidenceId: ev.id, path: p, file: ev.file, status, action, ...extra,
        claims: cites.map((c) => c.pointer), manualSections, manualOnly, message,
      });
    };

    if (!Array.isArray(lines)) {
      // Gone from the repository: stale. Outside it, or unreadable: we must
      // not (or cannot) look, so the evidence can't be verified at all.
      if (lines.reason === 'not-found' || lines.reason === 'not-file') found('missing', lines.error);
      else report.error('evidence.file', `${p}/file`, lines.error);
      return;
    }
    if (ev.endLine <= lines.length && hashSnippet(lines, ev.startLine, ev.endLine) === ev.snippetHash) {
      if (ev.symbol && !lines.slice(ev.startLine - 1, ev.endLine).join('\n').includes(ev.symbol)) {
        report.warn('evidence.symbol', `${p}/symbol`, `"${ev.symbol}" does not appear in ${at}`);
      }
      return;
    }

    const matches = findSnippet(lines, ev.endLine - ev.startLine + 1, ev.snippetHash);
    if (matches.length === 1) {
      const [to] = matches;
      found('moved', `${at} moved to lines ${to.startLine}-${to.endLine}`, { movedTo: to });
    } else if (matches.length > 1) {
      found('ambiguous', `${at} no longer matches; the cited lines appear ${matches.length} times in the file`, { candidates: matches });
    } else {
      found('changed', `${at} no longer matches the cited code`);
    }
  });

  // A listed file that no longer exists is covered by the stale entry of any
  // evidence citing it. Without such evidence there is no hash to prove the
  // file ever existed, so it stays an error.
  const evidenceFiles = new Set(manifest.evidence.map((ev) => ev.file));
  const checkFile = (file, pointer, message) => {
    const resolved = tree.resolve(file);
    if (typeof resolved === 'string') return;
    const gone = resolved.reason === 'not-found' || resolved.reason === 'not-file';
    if (!gone) report.error('file.missing', pointer, resolved.error);
    else if (!evidenceFiles.has(file)) report.error('file.missing', pointer, message ?? resolved.error);
  };

  manifest.analysis.files.forEach((f, i) => checkFile(f.path, `/analysis/files/${i}/path`));

  manifest.analysis.impact.items.forEach((item, i) => {
    if (item.file === undefined) return;
    const p = `/analysis/impact/items/${i}/file`;
    if (item.change === 'add') {
      if (tree.exists(item.file)) report.warn('impact.file-exists', p, `change is "add" but ${item.file} already exists`);
    } else {
      checkFile(item.file, p, `${item.file} does not exist; use change "add" for a file that should be created`);
    }
  });

  return stale;
}
