// Interfaces between FeatureLens stages. FeatureLens does not call Claude and
// does not inspect the repository on its own: Claude Code investigates the
// code and supplies the analysis (as input to createManifest, or as a revised
// manifest), and FeatureLens validates, renders and writes it.
//
//   Claude Code ─▶ manifest data ─▶ validate ─▶ checkWriteGate ─▶ render ─▶ write
//                      ▲                │
//                      └── stale[] ─────┘  (Claude revises the claims it lists)
//
// This module has no runtime exports.

/**
 * Turns a valid manifest into the HTML document. Pure: no file I/O, no git,
 * no repository or source reads; same input gives same output. Source
 * excerpts and stale entries are read by the caller and passed in.
 * Implemented by src/render/render.js. It uses buildImpactGraph
 * (src/analysis/impact-graph.js) for derived impact and the diagram models
 * of src/analysis/diagram-model.js (impact, architecture) and
 * src/analysis/flow-models.js (execution flow, sequence, state machine, data
 * flow) for diagrams rather than interpret the analysis itself, and it only
 * runs on manifests that pass checkWriteGate. A model that doesn't hold
 * together is a RenderError: no partial diagram is ever rendered.
 *
 * The result starts with a `<!doctype html>` line and has no marker;
 * output/writer's writeFeatureDocument stamps the marker on line 2 and writes it.
 * @typedef {object} Renderer
 * @property {(manifest: import('./manifest/types.js').Manifest, inputs: import('./render/inputs.js').RenderInputs) => string} render
 */

/**
 * Source lines for one evidence entry, supplied to the renderer by the
 * caller. See src/render/inputs.js.
 * @typedef {import('./render/inputs.js').SourceExcerpt} SourceExcerpt
 */

/**
 * Freshness of a document against the repository: the `stale` entries of a
 * validation result. Each entry says which evidence is out of date, how
 * (moved, changed, missing, ambiguous), which claims cite it, and what
 * resolving it takes (relocate, reanalyze, review). An update is Claude
 * working through this list, not FeatureLens deciding what to re-analyze.
 * @typedef {import('./validation/repository.js').StaleEntry[]} Freshness
 */

/**
 * Whether a validation result may be written. See src/validation/gate.js.
 * @typedef {import('./validation/gate.js').WriteGate} WriteGate
 */

export {};
