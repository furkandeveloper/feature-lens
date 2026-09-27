# Roadmap

FeatureLens 1.0.0 is everything marked ✅ below. The sections after it
("Known limitations and backlog", "Later") are ideas and known gaps, not
commitments or scheduled work. Each completed phase ended with passing
tests, updated docs and a working example.

## Phase 1 — Architecture and manifest schema ✅ (v0.2)

- Module layout with explicit stage contracts; the engine does not depend on HTML ([ARCHITECTURE.md](ARCHITECTURE.md))
- Manifest schema 1.0.0 ([MANIFEST.md](MANIFEST.md)): metadata, analysis
  (files, components, endpoints, models, externals, relationships, impact
  items and relationships, unknowns and limitations), optional typed
  visualizations, documentation sections with provenance and manual markers,
  update history with revision chain and validation result
- Evidence model: kind, explanation, confidence, revision, snippet hash; `createSourceRef` refuses nonexistent locations
- Validation with stable issue codes: version gate, schema, references,
  graphs, sections, history, evidence against the repository
- Manifest generation and update recording (`createManifest`, `recordUpdate`)
- Impact graph, safe output writer
- CLI: `validate`, `git-info`
- Example repository + manifest used as a test fixture; minimal manifest fixture

### Phase 1 corrections ✅

- Stale evidence is its own validation result (`moved`, `changed`,
  `missing`, `ambiguous`, with the citing claims and a `manualOnly` flag),
  not an error; `validate` exits 3 for valid-but-stale documents
- `checkWriteGate`: the rule render and update apply before writing
- Schema 1.0.0 corrected in place: `snippetHash` required,
  `provenance.contentHash` removed
- `dirty` counts untracked files
- Removed what duplicated Claude Code: source file discovery
  (`listSourceFiles`), changed-file listing (`getChangedFiles`), the
  planned `inventory` and per-reference `evidence` commands, and the
  `FeatureAnalyzer`/`DocumentationUpdater` interfaces
- Output contract documented: companion `manifest.json`, self-hashed HTML
  marker, refusal rules ([ARCHITECTURE.md](ARCHITECTURE.md) §6–7)

(Phase 0, v0.1, was the first draft of the schema, the validator, git metadata and config.)

## Phase 2A — Output safety and HTML marker ✅

- `src/output/marker.js`: fixed-order marker on line 2, SHA-256 of the
  document without the marker line, strict byte-exact parsing
- `src/output/existing.js`: `checkExistingOutput` refuses missing,
  misplaced, duplicate, malformed or invalid markers, hash mismatches,
  feature id and schema version mismatches, and HTML without its manifest;
  a valid hash with a `historyId` mismatch regenerates and is reported
- `writeFeatureDocument`: checks existing output, writes `index.html`,
  verifies it, writes `manifest.json` last; `force: true` is explicit and
  reported. Renderer contract is `render(manifest, { excerpts, stale })`
- Boundary tests: only `output/writer.js` writes files; no network modules
  or external URLs in `src/` or `bin/`

## Phase 2B — Pure HTML renderer ✅

- Pure `render(manifest, { excerpts, stale })` returning the unmarked HTML
  for `writeFeatureDocument` to stamp (ARCHITECTURE.md §6.1)
- Excerpt contract `{ evidenceId, file, startLine, endLine, text }`, checked
  against each evidence entry's location and `snippetHash`
- Every section kind renders its analysis data; manual sections show only
  what a person wrote; certainty badges on every claim; excerpts with line
  numbers; stale evidence labelled unverified, without code
- Direct impact, declared impact relationships and derived impact in
  separate lists, derived labelled as not a claim
- Static, no scripts, CSP forbids loading anything; escaping by
  construction (`html` tagged template); tests for injection, determinism,
  no marker, no network and purity

## Phase 2C — Render command and Claude Code plugin ✅

- `featurelens render <manifest> --repo <dir> --excerpts <file>
  [--acknowledge <id> ...] [--json]`: validate against the repository →
  `checkWriteGate` → excerpts checked with `indexInputs` → pure `render` →
  `writeFeatureDocument` (stamp, existing-output check, `manifest.json`
  last). Exit codes 0/1/2/3 as for `validate`; 3 also covers documents
  written with acknowledged manual-only stale evidence
- Excerpt handoff: Claude Code collects the cited lines with its own tools
  and writes a JSON array of `SourceExcerpt`; the CLI never reads source to
  fill it in (ARCHITECTURE.md §6.2). No schema change
- `--acknowledge` exposes the existing manual-only acknowledgement; no
  `--force` flag
- Plugin: `.claude-plugin/plugin.json` and `skills/featurelens/SKILL.md`
  (create, validate, excerpts, render, stale handling, refused output,
  updates); `test/plugin.test.js` checks the skill against the CLI;
  `claude plugin validate .` passes

## Phase 3A — Static impact diagram foundation ✅

- Pure diagram model (`src/analysis/diagram-model.js`) from existing
  manifest data, no schema change: direct nodes, declared edges, derived
  nodes and edges (not claims, no evidence), stable ids, manifest order,
  strict checks (unknown evidence, dangling edges, conflicting duplicates)
- Static SVG (`src/render/diagram.js`): deterministic layered layout, no
  script, ids, links or `url()`; line style and text, not color alone,
  tell direct, derived and unverified apart; legend and text version
- Impact diagram in generated `impact` sections; architecture views drawn
  wherever listed; stale evidence shown as unverified; CSP unchanged
- Narrow screens: each diagram scales to fit or scrolls in its own
  container (checked at 390px)

## Phase 3B — Flow, sequence, state and data-flow diagrams ✅

- No schema change: all four types were already in schema 1.0.0 and the
  validator
- Pure typed models (`src/analysis/flow-models.js`), one per type, sharing
  the Phase 3A claim check and duplicate rule: steps and links (a link is
  part of its step's claim), participants and ordered messages, states
  and transitions (initial and terminal only as declared, repeats marked),
  data nodes by kind and flows; no derived items, nothing inferred
- Static SVG (`src/render/flow-diagram.js`): layered layout from the start
  step or initial state, edge labels in two staggered rows per gap,
  self-loops drawn, parallel edges on one line with a count; sequences as
  lifelines and numbered rows in message order; legend and complete text
  version for each
- Narrow screens: these diagrams scale to fit only up to 360px and
  otherwise scroll in their container (checked at 390px, light and dark)

## Phase 3C — Architecture layout and group boxes ✅

- No schema change: groups and membership come from the view's `groups[]`
  and `nodes[].group` only; a node is in at most one group; groups are not
  claims and carry no evidence
- Group boxes (`src/render/architecture-layout.js`): a box per group with
  nodes, spanning its layers so no other node can be inside it; boxes
  never overlap; headings cut to fit, complete in `<title>` and the text
  version, which also lists empty groups and ungrouped nodes
- Deterministic crossing reduction: bounded barycenter sweeps (at most 4
  iterations, skipped above 1500 node pairs), best result kept, never more
  crossings than manifest order, manifest order on ties
- Skip-layer edges that would pass behind a node bend through the nearest
  gap; parallel, opposite and self-loop semantics unchanged
- Impact and Phase 3B diagrams unchanged byte for byte; checked at 1280px
  and 390px, light and dark, with many groups, long labels, disconnected
  components and a wide group

## Phase 3D — Interactive impact graph ✅

- Opt-in: `render --interactive` (`render(manifest, inputs, { interactive:
  true })`). Not stored, no schema change. Without it, and for documents
  without an impact diagram, output is byte for byte the Phase 3C output
- Progressive enhancement of the static impact diagram only: index-based
  `data-*` references (`n<i>`, never manifest ids) on nodes, drawn edges
  and text version items; one constant inline script at the end of
  `<body>` that adds focusable node buttons, a reset button, a details
  panel and a status line. Blocked or disabled script leaves the static
  document, with no dead controls
- CSP adds only `script-src 'sha256-…'` of that script: no nonce, no
  `'unsafe-inline'` or `'unsafe-eval'` for scripts, still `default-src
  'none'`. No embedded data; details are copies of the escaped text version
- Selecting a node highlights its direct incoming and outgoing drawn
  relationships and dims the rest; declared, derived and unverified keep
  their styles and text. Keyboard: Tab, Enter/Space, Escape; visible
  focus outline; selection shown by border width, bold label and dimming,
  not color alone; no animation
- Tests: output compatibility, CSP and hash, escaping of hostile ids and
  labels, script text; behavior in headless Chrome over the DevTools
  protocol with no dependencies (skipped without Chrome), at 1280px and
  390px, light and dark; intentional regressions caught

## Phase 3E — Real repository evaluation and release hardening ✅

- Evaluation matrix ([EVALUATION.md](EVALUATION.md), `eval/run.js`): the
  sample, expressjs/express at 4.21.2 (also 4.19.2 and v5.0.0), many
  architecture groups, large and wide impact graphs up to 1,000
  components, every stale status, hostile text, no visualizations,
  interactive rendering; every normal and failure path through the real
  CLI and writer (539 expectations); timings, sizes and a headless Chrome
  review at 390px and 1280px, light and dark
- Browser test policy: each browser test is reported as skipped without
  Chrome, never hidden; `FEATURELENS_REQUIRE_BROWSER=1`, `npm run
  test:browser` and `npm run check:release` require it
- Fixed: `createManifest`/`recordUpdate` recorded "invalid" in history for
  manifests with `undefined` optional fields that validate once written;
  an unreadable `.featurelens.json` crashed the CLI
- No schema, writer, output confinement, history or CSP change

## Build and update workflow ✅

- `featurelens build <draft.json> --repo --out`: Claude writes one draft
  (feature, evidence locations, analysis, visualizations, sections,
  summary); the command refuses a feature that already has a document,
  stamps every location with `createSourceRef` (listing every one that
  doesn't exist), fills repository and person metadata from
  `git/metadata.js`, calls `createManifest`, validates and applies the
  write gate. Replaces the scratch build script earlier versions of the
  skill had Claude write
- `featurelens update <copy> --repo --summary --out [--changed-file]
  [--edit-manual] [--acknowledge]`: reads the existing `manifest.json`
  itself (confined to the repository), re-stamps evidence whose
  `snippetHash` Claude removed after re-reading the code, and
  `planUpdate` refuses history, feature id and unrequested manual-section
  changes, then computes `changedSections` with a reason per section,
  the touched evidence, and manual sections to review; `recordUpdate` at
  the current git revision (branch, remote and dirty refreshed) → gate.
  Replaces the `update.mjs` script earlier versions of the skill had
  Claude write
- `validate` lists, for each stale entry, the generated and manual
  sections that show it
- `build` and `update` write only a working manifest, never inside the
  output directory (`writeWorkingManifest`); `render` stays the only way
  a document changes
- The writer refuses a manifest that changes or removes a manual section
  of the existing `manifest.json` without a new history entry recording
  it (`manual-section-changed`), so manual content is protected even when
  `update` is bypassed
- No schema, renderer, CSP or diagram change
- Tests: `test/workflow.test.js` (build, update with current, moved,
  changed, missing and ambiguous evidence, section reporting, manual
  sections, refusals without output mutation, determinism, git revision
  chain), writer tests for `manual-section-changed`, and the skill's
  commands run as written (`test/plugin.test.js`)

**MVP = Phases 1–2C + the build/update workflow.** A user can generate and
update feature docs end to end.

## Release 1.0.0 preparation ✅

- Version 1.0.0 of the tool and plugin; manifest schema 1.0.0 unchanged
- Open-source release files: README, CHANGELOG, CONTRIBUTING, SECURITY,
  SUPPORT, Code of Conduct, issue and pull request templates
- `.claude-plugin/marketplace.json`, so the repository can be installed
  with `/plugin marketplace add` and `/plugin install`
- No product, schema, renderer or CSP change

## Documentation app and presentation modes ✅

- The page is a documentation app: an overview page (feature, repository,
  evidence status, key facts, the summary section, links to findings, top
  risks, open questions and diagrams), a sticky sidebar that groups
  sections by kind and lists their diagrams, one page per section chosen
  by the URL hash, previous/next links, a mobile drawer, a skip link
  ([ARCHITECTURE.md](ARCHITECTURE.md) §6.1.5)
- No script: pages, the current-page highlight and the drawer are
  `:target` and `:has()` rules built from page indexes only. Without
  `:has()`, and in print, every page is shown
- `render --mode developer|product` (default `developer`): the same
  claims, certainty and evidence, worded and disclosed for engineers or
  for readers who need behavior
- Evidence grouped by file; risk, unknown and evidence cards; disclosure
  for secondary detail; restyled diagrams, light and dark
- 49 new tests (26 unit and CLI, 21 in headless Chrome, 2 browser policy);
  existing browser tests open the impact page by its hash
- No schema, manifest, evidence, validation, write gate, build/update,
  writer, output confinement or CSP change

## Known limitations and backlog

These are documented limitations of 1.0.0. They are candidates for future
work, not planned releases.

### Diagrams

- Edge routing for the impact diagram, and for long adjacent-layer edges
  in every layered diagram: no edge drawn through a node that is not its
  end (EVALUATION.md F-4, F-5; `edgesThroughNodes` in `eval/run.js` is the
  acceptance measure). Changes diagram geometry, so it needs its own
  compatibility decision. Until then, large or wide impact graphs may
  contain edges passing through or behind nodes; the text version and the
  selected node's details are the authoritative fallback
- Interaction for architecture views and flow diagrams, each with its own
  contract; pan and zoom for wide graphs

### Workflow

- Re-stamping is trust-based: `update` re-stamps evidence whose
  `snippetHash` Claude removed and can't check that the claims citing it
  were revised
- `--changed-file` is supplied by Claude; FeatureLens doesn't list changed
  files itself (by design: repository inspection belongs to Claude Code)
- Evaluate the skill with `claude plugin eval` on the example repo plus
  2–3 real open-source repositories, including prompts that require an
  `unknowns[]` entry instead of a guess

### Documentation layout

- No search, and no current-section highlight within a page; the drawer
  doesn't close on Escape. Each needs a script, which static pages don't
  carry
- Product mode words the interface, not the analysis: claim text stays as
  written

## Later

- Optional language-aware evidence providers (e.g. tree-sitter) for call graphs
- GitHub login resolution through `gh` when authenticated
- Multi-feature index page; cross-links between feature docs
- CI mode: flag docs with stale evidence (`validate` exit code 3)
- Hosted / team features (sharing, review workflows)
