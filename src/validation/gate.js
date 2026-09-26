// The rule every command that writes a manifest or rendered document must
// apply to the validation result first. `render` applies it before handing
// files to output/writer; `build` and `update` before writing their
// working manifest.

/**
 * @typedef {object} WriteGate
 * @property {boolean} ok
 * @property {string[]} reasons why writing is refused; empty when ok
 * @property {import('./repository.js').StaleEntry[]} blocking stale entries that still need handling
 */

/**
 * A manifest may be written only when it is valid, its evidence was checked
 * against the repository, and no stale evidence is left unhandled.
 *
 * Stale evidence is handled by fixing it (relocating or re-analyzing and
 * re-stamping). The one exception is evidence that only manual sections
 * cite: FeatureLens never rewrites those, so a person may explicitly
 * acknowledge it by id to write anyway. Acknowledging any other stale entry
 * has no effect.
 *
 * @param {import('./validate.js').ValidationResult} result
 * @param {{ acknowledged?: string[] }} [options] evidence ids of manual-only stale entries to accept
 * @returns {WriteGate}
 */
export function checkWriteGate(result, { acknowledged = [] } = {}) {
  const reasons = [];
  if (!result.valid) reasons.push(`the manifest has ${result.errors.length} validation error(s)`);
  if (!result.evidenceChecked) reasons.push('evidence was not checked against the repository');

  const accepted = new Set(acknowledged);
  const blocking = result.stale.filter((s) => !(s.manualOnly && accepted.has(s.evidenceId)));
  for (const s of blocking) {
    reasons.push(s.manualOnly
      ? `evidence "${s.evidenceId}" is ${s.status} and only manual sections cite it; review it or acknowledge it explicitly`
      : `evidence "${s.evidenceId}" is ${s.status}; ${s.action} it before writing`);
  }
  return { ok: reasons.length === 0, reasons, blocking };
}
