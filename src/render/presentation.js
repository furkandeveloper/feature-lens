// Presentation modes: how the same manifest is worded and how much detail is
// open by default. A mode never adds, removes or changes a claim, its
// certainty or its evidence; it only chooses labels and which details start
// collapsed. Pure data, no markup.

export const MODES = Object.freeze(['developer', 'product']);
export const DEFAULT_MODE = 'developer';

/** What each certainty means (docs/MANIFEST.md), the same in both modes. */
export const CERTAINTY_MEANING = {
  observed: 'Read directly in the cited lines.',
  inferred: 'A reasonable conclusion from the cited lines, not stated literally.',
  proposed: 'Recommended implementation impact; not in the code.',
  unknown: 'Could not be determined.',
};

const WORDS = {
  developer: {
    view: 'Developer view',
    certainty: { observed: 'observed', inferred: 'inferred', proposed: 'proposed', unknown: 'unknown' },
    unknownKind: { question: 'question', limitation: 'limitation' },
    groups: {
      overview: 'Overview',
      architecture: 'Architecture',
      behavior: 'Behavior & flows',
      quality: 'Risks & quality',
      notes: 'Notes',
      reference: 'Reference',
    },
    findings: 'Findings',
    components: 'Components',
    relationships: 'Relationships',
    files: 'Relevant files',
    sources: 'Sources',
    evidence: 'Evidence',
  },
  product: {
    view: 'Product view',
    certainty: { observed: 'Read in code', inferred: 'Inferred from code', proposed: 'Proposed change', unknown: 'Undetermined' },
    unknownKind: { question: 'Open question', limitation: 'Known limitation' },
    groups: {
      overview: 'Overview',
      architecture: 'How it is built',
      behavior: 'How it behaves',
      quality: 'Risks & open questions',
      notes: 'Notes',
      reference: 'Sources & history',
    },
    findings: 'Key points',
    components: 'Building blocks',
    relationships: 'How the parts connect',
    files: 'Files involved',
    sources: 'Sources',
    evidence: 'Sources',
  },
};

/** @param {'developer' | 'product'} mode */
export function words(mode) {
  return WORDS[mode];
}
