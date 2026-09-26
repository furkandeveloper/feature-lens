// Update-history consistency: one creation first, chronological order, an
// unbroken revision chain, timestamps that agree with metadata, and recorded
// validation results that make sense.

import { uniqueIds } from './report.js';

/**
 * @param {import('../manifest/types.js').Manifest} manifest
 * @param {import('./report.js').Report} report
 * @returns {Set<string>} history entry ids
 */
export function checkHistory(manifest, report) {
  const { history, metadata } = manifest;
  const ids = uniqueIds(history, '/history', report);

  history.forEach((h, i) => {
    const p = `/history/${i}`;
    const expected = i === 0 ? 'created' : 'updated';
    if (h.action !== expected) {
      report.error('history.action', `${p}/action`, i === 0 ? 'first history entry must be "created"' : 'only the first history entry may be "created"');
    }

    if (i === 0) {
      if (h.previousRevision !== undefined) {
        report.error('history.revision-chain', `${p}/previousRevision`, 'the creation entry has no previous revision');
      }
    } else {
      const prev = history[i - 1];
      if (Date.parse(h.at) < Date.parse(prev.at)) report.error('history.order', `${p}/at`, 'history must be in chronological order');
      if (h.previousRevision !== prev.revision) {
        report.error('history.revision-chain', `${p}/previousRevision`,
          `must equal the previous entry's revision (${prev.revision ?? 'none'}), got ${h.previousRevision ?? 'none'}`);
      }
    }

    const v = h.validation;
    if (v.valid !== (v.errorCount === 0)) {
      report.error('history.validation', `${p}/validation`, `valid is ${v.valid} but errorCount is ${v.errorCount}`);
    }
  });

  const first = history[0];
  const last = history.at(-1);
  if (Date.parse(metadata.generatedAt) !== Date.parse(first.at)) {
    report.error('history.timestamps', '/metadata/generatedAt', `must equal the first history entry's timestamp (${first.at})`);
  }
  if (Date.parse(metadata.updatedAt) !== Date.parse(last.at)) {
    report.error('history.timestamps', '/metadata/updatedAt', `must equal the last history entry's timestamp (${last.at})`);
  }
  if (last.revision !== metadata.repository.revision) {
    report.error('history.revision-chain', '/metadata/repository/revision',
      `must equal the last history entry's revision (${last.revision ?? 'none'}), got ${metadata.repository.revision ?? 'none'}`);
  }

  return ids;
}
