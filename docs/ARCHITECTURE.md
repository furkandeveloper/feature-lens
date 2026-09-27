# FeatureLens architecture

Status: 1.0.0. Implemented: the architecture and manifest schema,
output safety and the HTML marker, the pure HTML renderer, the `render`
command and Claude Code plugin, static impact, architecture,
execution-flow, sequence, state-machine and data-flow diagrams,
architecture layout and group boxes, the opt-in interactive impact graph,
the build/update workflow (`build` and `update` commands, §2 and §7), and
the documentation-app layout with developer and product modes (§6.1.5).
Sections below name the phase that introduced each part; see
[ROADMAP.md](ROADMAP.md). The manifest format has its own reference:
[MANIFEST.md](MANIFEST.md).

## 1. The core split: reasoning vs. guarantees

FeatureLens has two kinds of work, and they go in different places:

| Work | Done by | Why |
|---|---|---|
| Inspecting the repository, searching and reading code, git investigation, interpreting the feature request, judging dependencies and impact, writing and revising the analysis, collecting source excerpts, deciding which documents to create or update | **Claude Code**, with its own tools, guided by the FeatureLens skill (`skills/featurelens/SKILL.md`) | Needs language understanding across any stack. Claude Code already has search, file reading and git; FeatureLens does not duplicate them. |
| Everything that must be *reliable*: the manifest contract, evidence stamping and checking, validation, freshness (stale evidence), attribution rules, history, rendering, safe output | **The `featurelens` library and CLI** (deterministic Node.js, zero dependencies) | Must be testable, reproducible, and must not hallucinate. |

FeatureLens never calls Claude, never decides what to analyze, and never
walks the repository on its own. It only reads the files a manifest cites.

The two halves share one versioned contract: the **manifest**
(`schema/featurelens-manifest.schema.json`). Claude produces the analysis,
and the library assembles it into a manifest, validates it against the
repository, and refuses to write one that fails. This is how the rule
"never invent files, functions or paths" is enforced mechanically, not only
by instruction.

## 2. Workflows

**Create.**

```
 Claude Code                                        FeatureLens
 ───────────                                        ───────────
 reads code, runs git (own tools)
 writes draft.json: feature, evidence locations,
 analysis, visualizations, sections, summary ─────▶ featurelens build:
                                                    existing document? → refuse (update it)
                                                    createSourceRef per location (lines must exist)
                                                    git metadata → createManifest → validateManifest
                                                    → checkWriteGate → working manifest (--out, scratch)
          ◀── errors (by code, JSON Pointer) ─ fix the draft and retry
                                                    featurelens render:
 reads the cited lines, writes excerpts.json ─────▶ validateManifest --repo → checkWriteGate
                                                    → excerpts checked → render → output/writer
                                                    <outputDir>/<feature-id>/manifest.json + index.html
```

**Update.**

```
 Claude Code                                        FeatureLens
 ───────────                                        ───────────
 copies <outputDir>/<id>/manifest.json ───────────▶ featurelens validate --repo:
                                                    stale[] with claims and sections
 relocates moved evidence; re-reads the code
 behind changed/missing evidence, revises the
 claims, drops snippetHash to re-stamp; asks the
 user about ambiguous and manual-only entries ────▶ featurelens update:
                                                    existing manifest.json (confined read)
                                                    stamp unstamped evidence → structure check
                                                    planUpdate: refuse history, feature id or
                                                      manual-section changes (unless --edit-manual);
                                                      touched evidence → changed sections + reasons
                                                    git metadata → recordUpdate → validate
                                                    → checkWriteGate → working manifest (--out)
 collects excerpts ───────────────────────────────▶ featurelens render (as above; the writer
                                                    refuses history-regression and
                                                    manual-section-changed)
```

`build` and `update` never write into the output directory
(`writeWorkingManifest` refuses it): a document changes only through
`render`, after the write gate.

## 3. Modules

| Responsibility | Module | Status |
|---|---|---|
| Repository inspection, feature analysis, impact analysis, flow extraction, excerpt collection | Claude Code with its own tools, guided by the skill. No FeatureLens module. | external; skill in `skills/featurelens/SKILL.md`, plugin metadata in `.claude-plugin/plugin.json` |
| Evidence stamping and source reading | `src/evidence/source.js` → `SourceTree`, `createSourceRef`, `hashSnippet`, `findSnippet` | implemented |
| Manifest generation and update history | `src/manifest/build.js` → `createManifest`, `recordUpdate`, `sectionsCitingEvidence` (evidence → dependent sections, for `changedSections`) | implemented |
| Build and update workflow | `src/manifest/workflow.js` → `buildFromDraft` (draft → stamped evidence → `createManifest`), `planUpdate` (existing vs. revised manifest → refusals, touched evidence, `changedSections` with reasons, manual sections to review), `stampEvidence`, `existingDocument` | implemented; used by `build` and `update` |
| Manifest types | `src/manifest/types.js` (JSDoc, mirrors the schema) | implemented |
| Manifest validation and freshness | `src/validation/` → `validateManifest` (`errors`, `warnings`, `stale`) | implemented |
| Write gate | `src/validation/gate.js` → `checkWriteGate` | implemented; used by `build`, `update` and `render` |
| Repository and attribution metadata | `src/git/metadata.js` → `getRepositoryInfo`, `getCurrentUser`, `getContributors` | implemented |
| Impact graph (render data) | `src/analysis/impact-graph.js` → `buildImpactGraph`, `dependencyEnds` | implemented |
| Diagram models | `src/analysis/diagram-model.js` → `impactDiagram`, `architectureDiagram`, `buildDiagram` (§6.1.1); `src/analysis/flow-models.js` → `executionFlowDiagram`, `sequenceDiagram`, `stateMachineDiagram`, `dataFlowDiagram` (§6.1.2) | implemented |
| Manifest and excerpt file loading, serialization | `src/docs/store.js` → `loadManifestFile`, `loadExcerptFile`, `serializeManifest` | implemented |
| HTML rendering | `src/render/render.js` → `render(manifest, { excerpts, stale }, { interactive?, mode? })`; `src/render/inputs.js` (excerpt contract); `src/render/escape.js`; `src/render/diagram.js`, `src/render/flow-diagram.js` (static SVG); `src/render/interactive.js` (the impact graph script, its CSP hash and style); `src/render/layout.js` (pages, sidebar, top bar, page rules), `src/render/overview.js` (overview page), `src/render/claims.js` (claims and sources), `src/render/presentation.js` (modes), `src/render/style.js` (stylesheet) | implemented (static by default; all diagram types; opt-in interactive impact graph, §6.1.4; documentation layout and modes, §6.1.5) |
| HTML marker (create, parse, hash-check) | `src/output/marker.js` → `stampDocument`, `readMarker`, `markerLine`, `hashDocument` | implemented |
| Existing-output safety check | `src/output/existing.js` → `checkExistingOutput`, `compareHistory` | implemented |
| File system output | `src/output/writer.js` → `writeFeatureDocument` (index.html + manifest.json), `writeDocumentation` (other files), `writeWorkingManifest` (`build`/`update` output, refused inside the output directory) | implemented |
| Configuration | `src/config/config.js` → `loadConfig` | implemented |
| CLI (composition root) | `bin/featurelens.js` | `build`, `validate`, `update`, `render`, `git-info` |

`git/metadata.js` stays even though Claude Code can run git: it is where the
attribution rules (email opt-in, credential redaction, `source` on every
identity) are applied, so they don't depend on each run getting them right.

### Dependency rules

```
bin/featurelens.js            ← the only place that wires modules together
  ├─ docs/store               (bytes ⇄ objects)
  ├─ manifest/workflow ──▶ manifest/build, evidence/source
  ├─ manifest/build ──▶ validation/validate ──▶ schema/json-schema
  │                                  │           ├─ validation/{semantic,visualizations,history}
  │                                  │           └─ validation/repository ──▶ evidence/source
  ├─ analysis/impact-graph    (pure; imports nothing)
  ├─ analysis/diagram-model ──▶ analysis/impact-graph   (pure)
  ├─ analysis/flow-models ──▶ analysis/diagram-model   (pure)
  ├─ render/render ──▶ render/{escape,inputs,diagram,flow-diagram,interactive,layout,overview,claims,presentation,style}, analysis/{impact-graph,diagram-model,flow-models}   (pure; node:crypto only)
  ├─ output/writer ──▶ output/existing ──▶ output/marker   (existing, marker: pure)
  │                └─▶ docs/store (serializeManifest)
  ├─ git/metadata
  └─ config/config ──▶ schema/json-schema

 validation/gate               (pure; reads a ValidationResult)
```

- **The engine knows nothing about HTML.** Analysis, evidence, validation,
  manifest building and the impact graph take and return plain manifest data.
  The renderer gets a validated manifest plus caller-supplied excerpts and
  stale entries, uses `buildImpactGraph`, and returns one HTML string. It
  does no I/O.
- **One module per side effect.** Only `output/writer.js` writes
  documentation, and only its `writeFeatureDocument` writes `index.html`
  and `manifest.json`. Only `evidence/source.js` reads cited source files. Only
  `git/metadata.js` runs git. `test/boundaries.test.js` enforces the write,
  process and no-network rules. Everything else is a pure function of its
  inputs, plus `validation/repository.js`, which reads through `SourceTree`.
- **The schema is the source of truth.** `types.js` mirrors it for editors;
  when they disagree, the schema wins and `types.js` is fixed.

## 4. The manifest in one screen

Full reference: [MANIFEST.md](MANIFEST.md).

```
schemaVersion
metadata        feature (id, name, description, mode, request), repository (name, revision…),
                tool, generatedAt, updatedAt, generatedBy, contributors
evidence[]      source references; every claim cites these by id
analysis        scope, files, components (modules, classes, endpoints, models, externals…),
                relationships, findings, impact { items, relationships }, risks, testing, unknowns
visualizations  architecture?, executionFlows?, sequences?, stateMachines?, dataFlows?   (all optional)
documentation   sections[] with origin (generated | manual) and provenance → history entry
history[]       append-only; created first, then updates with revision chain and validation result
```

Every claim has a **certainty**: `observed` (read in the cited lines),
`inferred` (reasoned from them), `proposed` (recommended implementation
impact) or `unknown`. `observed` and `inferred` must cite evidence.
`unknowns[]` is required and is always rendered.

## 5. Validation

`validateManifest(manifest, { repoRoot? })` runs in layers and returns
`{ valid, errors, warnings, stale, evidenceChecked }`. Each issue has a
stable `code`, a JSON Pointer `path` and a `message`.

1. **Schema version**: an unsupported major, a newer minor or a malformed
   version is one `version.unsupported` error, and validation stops there.
2. **JSON Schema** (`schema.<keyword>`): structure, required fields, enums,
   id/path/revision/timestamp formats, and a `snippetHash` on every
   evidence entry. The validator throws on keywords it does not implement,
   so it can't quietly skip a rule someone adds.
3. **Semantics**: unique ids; every reference resolves; certainty rules;
   dependency graph (parent cycles, self-loops, duplicate edges);
   visualization graphs (edges inside their view, reachable steps, exactly
   one initial state, no transitions out of terminal states); section ids and
   provenance; history (creation first, chronological, revision chain,
   timestamps match metadata, consistent validation results). Also records
   which claims and sections cite each evidence id.
4. **Repository** (with `repoRoot`): paths that resolve outside the
   repository are errors. Every evidence entry is then classified by its
   `snippetHash`:

| Result | Condition | Reported as | Resolved by |
|---|---|---|---|
| current | The hash matches at the cited lines | nothing | — |
| `moved` | Exactly one other window of the same length in the file has the hash | `stale`, with `movedTo` | `relocate`: update the line numbers (the text is identical) |
| `changed` | No window in the file has the hash | `stale` | `reanalyze`: Claude re-reads the code and revises the cited claims |
| `missing` | The file was deleted or is no longer a regular file | `stale` | `reanalyze` |
| `ambiguous` | More than one window has the hash | `stale`, with `candidates` | `review`: nothing is moved automatically |

   Each stale entry lists the JSON Pointers of the claims and sections that
   cite the evidence, and `manualSections`. Evidence cited *only* by manual
   sections is `manualOnly` and always resolved by `review`, because
   FeatureLens never rewrites manual content. Files listed in the analysis
   (or impact files marked `modify`/`review`/`remove`) that don't exist are
   `file.missing` errors, unless evidence cites the same file: then the
   stale entry already covers it.

Layers 3 and 4 run together once 1 and 2 pass, so one run reports everything
that needs fixing. The full list of codes is in [MANIFEST.md](MANIFEST.md#validation-codes).

**Valid, stale and invalid are three different states.** Invalid (`errors`)
means the manifest can't be trusted as written. Stale means it was correct
when it was stamped and the code has moved on: the document needs an update,
not a fix. Staleness is never a warning: `featurelens validate` exits 0 only
when the manifest is valid *and* current, 3 when it is valid but stale, and 1
when it is invalid (invalid wins over stale).

**Write gate.** `checkWriteGate(result, { acknowledged? })` is the rule every
command that writes a manifest or document applies first: the manifest is
valid, its evidence was checked against the repository, and no stale entry
is left. The only stale entries that may be accepted without fixing are
`manualOnly` ones, and only when acknowledged explicitly by evidence id.

Why the acknowledgement is this narrow:

- **Generated claims can never keep stale evidence.** If any generated
  claim cites the evidence (including a finding placed in a manual
  section), the entry is not `manualOnly`, and acknowledging it does nothing.
  Claude must relocate or re-analyze it.
- **Manual content is never rewritten.** Evidence that only manual sections
  cite can't be fixed automatically, so the only choices are a person
  editing the section or explicitly accepting it as is.
- **Acknowledgement only removes stale entries.** Errors (including paths
  outside the repository and unreadable files) and unchecked evidence
  block regardless of what is acknowledged.
- **It is deterministic**: the outcome depends only on the validation
  result and the list of ids. Acknowledged entries stay stale in the
  manifest, so `validate` keeps exiting 3 until a person fixes the section.
  Renderers must show them as unverified (§6).

**Validation vs. write acceptance.** `createManifest` and `recordUpdate`
validate the manifest they build and record `{ valid, errorCount,
warningCount, evidenceChecked }` in its newest history entry. That summary
is about validity, not freshness. Writing is a separate step: a command
applies `checkWriteGate` to *that same* validation result, so every manifest
FeatureLens writes was current when it was written, apart from explicitly
acknowledged `manualOnly` entries. Stale evidence is therefore not recorded
in history. Recording acknowledgements would take an additive schema field
(a 1.x minor), and nothing needs it yet.

A fabricated location can't get past this: `createSourceRef` refuses
locations that don't exist, so a new manifest's hashes all come from real
lines, and the gate refuses anything not current.

## 6. Output contract

The marker, the existing-output check and the checked writer are
implemented (Phase 2A), and so are the renderer (Phase 2B, §6.1) and the
`render` command that connects them (Phase 2C, §6.2).

```
<outputDir>/            default docs/features, from .featurelens.json
  <feature.id>/
    manifest.json       the source of truth (serializeManifest output)
    index.html          derived from manifest.json; never edited by hand, never parsed
```

- **`manifest.json` is the source of truth.** Updates load it, never the
  HTML. It diffs cleanly in code review.
- **`index.html` is fully regenerated** from the manifest by a
  deterministic renderer. Even when only a few claims change, the whole
  document is rendered again; "updating a section" means Claude revises the
  analysis data that section shows. If a later version embeds data for
  interactive parts, nothing reads that copy back.
- **The renderer is pure** and does not create the marker (§6.1). The
  writer stamps the marker and owns every write; the renderer only returns
  a string.
- **Marker** (`src/output/marker.js`). Line 1 is `<!doctype html>`
  (any case); line 2, and only line 2, is the marker:

  ```html
  <!-- featurelens {"featureId":"payment-flow","schemaVersion":"1.0.0","historyId":"h-3","sha256":"<64 hex>"} -->
  ```

  - Exactly the four keys, in this order: `featureId`, `schemaVersion`,
    `historyId` (the manifest's last history entry), `sha256`.
    `featureId` and `historyId` use the manifest id pattern, `schemaVersion`
    is semver, `sha256` is 64 lowercase hex characters (no `sha256:` prefix).
  - The line is byte-exact: `<!-- featurelens `, the compact
    `JSON.stringify` of the fields, ` -->`, then `\n`. No other whitespace, no
    `\r`. A line that parses but differs from this canonical form is
    malformed.
  - `sha256` is the SHA-256 of the file's UTF-8 bytes with line 2 and its
    `\n` removed, i.e. line 1 + `\n` + everything after the marker line.
    The marker never covers itself, so its other fields can change without
    changing the hash.
  - `<!-- featurelens` must appear exactly once in the whole file. The
    renderer must never emit it; `stampDocument` refuses a document that
    already contains it.
  - Verification (`readMarker`) only splits lines and hashes bytes; it
    never interprets the HTML. It returns the first problem found, in this
    order: `marker-missing`, `marker-duplicate`, `marker-wrong-line`,
    `marker-malformed` (line format, JSON, or non-canonical text),
    `marker-invalid` (keys, key order, field values), `hash-mismatch`.
- **Writing** (`writeFeatureDocument` in `src/output/writer.js`, the only
  code that writes `index.html` and `manifest.json`):
  1. Check the manifest's feature id matches the target folder and stamp
     the HTML. Bad input fails here, before anything touches the disk.
  2. Read the existing `index.html` (bytes) and `manifest.json` and run
     `checkExistingOutput` (§7) with the new manifest's history. Unsafe
     output, including a history that doesn't extend the existing one
     (`history-regression`), throws `OutputRefusedError` unless
     `force: true` is passed.
  3. Write `index.html` (temp file + rename), read it back and verify its
     marker. On failure, stop: `manifest.json` is not written.
  4. Write `manifest.json` (`serializeManifest`) **last**.
  5. Return the paths written, the existing-output result (so callers
     report `history-mismatch` and forced replacements) and `forced`.

  Writing `manifest.json` last means an interrupted write leaves an intact
  HTML one history entry ahead of `manifest.json`. The next run sees a
  valid hash with a different `historyId` and regenerates from
  `manifest.json`. `writeDocumentation` writes any other files and refuses
  the two reserved names.
- **Manual content lives in the manifest**, in `origin: "manual"` sections,
  never in the HTML. To change it, a person (or Claude, on request) edits
  the manifest and re-renders.
- **No external requests.** CSS is inlined and the document has no
  scripts. A Content-Security-Policy `<meta>` (`default-src 'none'`, inline
  styles only) blocks loading anything even if markup slipped through. Docs
  work offline and in air-gapped repositories.
- **All manifest strings are text, never HTML.** Every value is escaped at
  render time. The renderer emits no `<script>` element. If a later version
  embeds data in `<script type="application/json">`, it must write `<` as
  `\u003c`, so no value can close the tag.
- **Stale evidence is shown as unverified**, never with a source excerpt.
- Writes are atomic per file and confined to `<repo>/<outputDir>/<feature.id>/`,
  even through symlinks. Confinement is checked **before** anything is
  created: the writer walks the output path one component at a time from
  the repository's real path, resolves every component that exists
  (a symlink must resolve to a directory inside the repository; a dangling
  one is refused), and only then creates the missing tail one directory at
  a time below the last verified one, re-checking each. So a symlink in
  `outputDir` that points outside the repository makes the write fail
  without creating any directory, inside or outside. Absolute, backslash
  and `..` output paths are refused outright. Auxiliary files
  (`writeDocumentation`) are confined to the feature folder the same way,
  and temporary files are created exclusively (`wx`) so a planted symlink
  is never followed. An existing `index.html` or `manifest.json` that
  isn't a regular file (a directory or a symlink) is refused, even with `force`.

### 6.1 Rendering

`render(manifest, { excerpts, stale })` in `src/render/render.js` returns
the complete document as a string: `<!doctype html>` on line 1, no marker,
ending with `\n`. It runs only on manifests that passed `checkWriteGate`,
and the result goes to `writeFeatureDocument`, which stamps the marker and
writes it.

**Boundary.** The renderer reads no files, writes none, runs no git or
other processes, uses no network, clock, randomness or environment, and
never parses existing HTML. Its only imports are `render/escape.js`,
`render/inputs.js`, `render/diagram.js`, `render/flow-diagram.js`,
`render/interactive.js`, `render/layout.js`, `render/overview.js`,
`render/claims.js`, `render/presentation.js`, `render/style.js`,
`analysis/impact-graph.js`, `analysis/diagram-model.js`,
`analysis/flow-models.js` and `node:crypto`
(`test/render.test.js` checks this and traps `fs`, `child_process`, `Date`,
`Math.random` and `process.env` during a render). Claude Code collects the
excerpts, the `render` command (§6.2) validates and checks them, and the
renderer only presents what it is given.

**Inputs** (`src/render/inputs.js`):

```js
/** @typedef {{ evidenceId, file, startLine, endLine, text }} SourceExcerpt */
excerpts: SourceExcerpt[]   // at most one per evidence id
stale:    StaleEntry[]      // the `stale` list of the validation result the gate accepted
```

- An excerpt's `file`, `startLine` and `endLine` must equal its evidence
  entry's, and `text` is the cited lines joined with `\n` (no trailing
  newline). `sha256(text)` must equal the evidence's `snippetHash`, so an
  excerpt is always exactly the code the evidence was stamped from. This is
  a check of the inputs against each other, not a re-validation of the
  repository.
- Excerpts exist only for one render call and are not stored in the
  manifest, so nothing is duplicated in `manifest.json`.
- Stale evidence must not have an excerpt: its code no longer matches.
  Evidence that is neither stale nor supplied is shown as "no excerpt",
  never as current, and nothing is inferred in its place.
- Excerpts for unknown ids, wrong locations, hash mismatches, duplicates,
  and stale entries for unknown ids throw `RenderError`. Array order never
  affects the output.

**Structure.** One `<h1>` (feature name); a header with the feature id,
description, mode, evidence count and unverified count, repository,
generation and update times, the last recorded validation, and
contributors; a contents list; one `<section id="section-<id>">` per
documentation section in manifest order; appendices when needed; a footer
naming the history entry. Everything inside a section is in manifest order
too. Nothing is sorted, so authors control the order.

**Sections.** Every section shows its title, origin badge, provenance (the
history entry that last changed it, with who and when), `body`,
`sourceRefs`, its findings (claims placed in it) and its visualizations. A
**generated** section also shows the analysis data of its kind:

| `kind` | Adds |
|---|---|
| `overview` | the feature request and, for change impact, the proposed change |
| `scope` | scope summary, in scope, out of scope, entry points |
| `architecture` | components (kind, parent, endpoint, dependency) and relationships |
| `implementation` | relevant files with role, reason and sources |
| `flows`, `custom` | nothing beyond the common parts |
| `impact` | the impact diagram (§6.1.1), direct impact items, declared impact relationships, derived impact |
| `risks`, `testing` | the notes, with severity |
| `unknowns` | all unknowns and limitations |
| `references` | the evidence catalog (see below) |
| `history` | the history table |

A **manual** section shows only the common parts: FeatureLens never puts
generated analysis data into it, whatever its `kind`. Its body is escaped
text like everything else. An unknown `kind` throws `RenderError`.

Because `unknowns[]` is always rendered and every evidence link needs a
target, the unknowns list and the evidence catalog go in the first
*generated* `unknowns` and `references` sections. If there is none, they go
in appendices (`#appendix-unknowns`, `#appendix-evidence`).

**Claims and evidence.** Each claim shows its `certainty` badge and links to
the evidence it cites (`file:start-end`, anchor `#evidence-<id>`). Each
catalog entry shows the location, kind, confidence, symbol, revision and
explanation, then one of:

- **current**: an excerpt was supplied (and matched its hash); the code
  is shown escaped, with line numbers.
- **unverified: `<status>`**: a stale entry was supplied. It shows the
  message, the action needed, `movedTo` or `candidates`, and who cites it:
  *generated claims* (not re-checked against the current code) or
  *only manual sections* (named, accepted for review). No code is shown.
  Links to it carry an "unverified" badge, and the header counts them.
- **no excerpt**: neither was supplied.

**Impact.** Three separate lists: *direct impact* (the manifest's impact
items, as claims), *declared impact relationships* (claims), and *derived
(indirect) impact*. The derived list is the `buildImpactGraph` nodes that
depend on something directly impacted without being impacted themselves.
Each one has a "derived" badge and no certainty or evidence, under a note
saying it is not a claim and follows the declared relationships.

**Attribution.** People are shown as recorded: display name (or "Unknown"),
email only if the manifest has one, GitHub login only if the manifest has
one, and always their `source`. Nothing is derived from names or emails.

**Visualizations** are shown by title, type and description, and drawn
as static diagrams: architecture views as in §6.1.1, execution flows,
sequences, state machines and data flows as in §6.1.2. A section shows the
visualizations it lists whatever its origin, as before: a person who lists
a view in a manual section chose it. A manual section still gets no other
generated analysis data.

#### 6.1.1 Static diagrams

The static diagrams: no pan, zoom, drag, filtering or script (the opt-in
interactive layer for the impact diagram is in §6.1.4 and changes none of
this). Diagrams draw only what the manifest already says; nothing is inferred from source
code, and the renderer adds no relationship of its own.

**Where.** A generated `impact` section starts with the *impact diagram*,
before the three impact lists. A manual `impact` section never shows it
(it is generated analysis data). Each `architecture` visualization is drawn
wherever a section lists it.

**Model** (`src/analysis/diagram-model.js`, pure, no HTML). No schema
change: every field comes from existing manifest data.

```
DiagramModel { id, title, nodes: DiagramNode[], edges: DiagramEdge[],
               groups? }                 // architecture views only (§6.1.3)
DiagramNode  { id, label, kind, impact: 'direct' | 'derived' | null,
               level?, changes?          // direct only
               certainty | null,         // null when derived
               evidenceIds: string[],    // [] when derived
               group? }                  // architecture views: the group's label
DiagramEdge  { id, source, target, kind, basis: 'declared' | 'derived',
               certainty | null, evidenceIds: string[], label?,
               via? }                    // derived only: the relationship ids followed
DiagramGroup { id, label, nodeIds: string[] }  // declared by the view; no claim
```

| | Impact diagram | Architecture view |
|---|---|---|
| Nodes | Every `buildImpactGraph` node that is directly impacted (`direct`: named by impact items; component id, or `file:<path>` for a file-only item) or has derived impact (`derived`) | The view's `nodes`, as their components (`impact: null`) |
| Node claim | The items' certainty, weakest one when several items name the node (so a node never claims more than its weakest item); the union of their evidence | The component's certainty and evidence |
| Declared edges | `analysis.impact.relationships`, item ids mapped to node ids; certainty and evidence as written | The view's `edges`, as their relationships |
| Derived edges | From an impacted (direct or derived) dependency to a component with derived impact that depends on it through a declared relationship (the direction rule of `buildImpactGraph`, `dependencyEnds`). Exactly the steps that marked it `indirect`. `via` lists the relationships; two relationships between the same pair give one edge | none |

- **Ids.** Nodes and declared edges keep their manifest ids. A derived edge
  is `derived:["<source>","<target>"]`, which no manifest id can equal.
- **Order.** Manifest order, like the rest of the renderer: nodes in
  `buildImpactGraph` order (components, then file-only items), declared
  edges in impact relationship order, then derived edges in relationship
  order. The same manifest always gives the same model.
- **Checks** (`buildDiagram`; a failure is a `DiagramError`, which the
  renderer turns into a `RenderError`, so the `render` command refuses
  instead of drawing part of a diagram): ids, labels and kinds present;
  edge ends are nodes; every evidence id is in `manifest.evidence`;
  certainty is known and `observed`/`inferred` cite evidence; derived
  nodes and edges have no certainty and no evidence, and derived edges name
  the relationships they follow; `level`/`changes` only on direct nodes.
  A repeated id is dropped when identical to the first and refused when it
  differs. On a manifest that passed validation none of these fire; they
  keep an unvalidated or hand-built input from producing a misleading
  picture.
- **Direct stays direct.** Derived is only ever computed for nodes with no
  impact item, and stale evidence never changes a node's or edge's class.

**Evidence and stale state.** The SVG says, in text, `N source(s)`,
`no evidence` or `unverified` for each claim; it never says "verified".
A node or edge that cites any stale evidence gets the `unverified` class
(warning color; edges dotted) and the word "unverified" in its text. The
text version links evidence with the same `refs` as the rest of the
document, so stale links carry the "unverified" badge and point to the
catalog entry, which shows no code. Derived items say "not a claim · no
evidence"; they never borrow the evidence of the relationships they follow.

**Drawing** (`src/render/diagram.js`). Inline `<svg role="img"
aria-label="…">` with a `<title>`, `<g>`, `<rect>`, `<text>`/`<tspan>` and
`<path>` only: no ids, links, `url()` references, inline styles, `xmlns`
URL, fonts or images, and every value goes through `html`. Arrowheads are
paths, not markers, so nothing references anything. Colors come from the
page's CSS variables (light and dark). Direct and derived differ by line
style (solid / dashed; dotted for unverified) and by text, never by color
alone. Each diagram is followed by a legend and a **text version** listing
every node and relationship with its certainty, sources, reason and, for
derived items, the relationships followed.

**Layout.** Deterministic layers: a depth-first walk in node order sets
aside edges that close a cycle, each node goes one layer below the deepest
node pointing at it, and each layer is centered in node order
(`assignLayers` in `src/render/layers.js`, shared by every layered
diagram). Architecture views add crossing reduction, group boxes and bent
skip-layer edges on top of the same layers (§6.1.3); the impact diagram
does not. Nodes are
200×72; labels wrap at spaces to two lines of 24 characters (longer tokens
are split, the rest ends with "…"; the full label is in the node's
`<title>` and the text version). Edges are straight lines between node
borders; parallel edges with the same basis share one line (their
`<title>` lists each), opposite edges are drawn side by side, and
self-loops are listed in the text version but not drawn.

**Narrow screens.** Each SVG sits in a `.diagram-scroll` container
(`overflow-x:auto; max-width:100%`). A diagram up to 480px wide (two nodes
per layer) scales down to fit (`fit`); a wider one keeps its size and
scrolls inside the container (`wide`), so the page never scrolls sideways.
Checked in headless Chrome at a 390px viewport with the sample.

**Known limitations.** The impact diagram has no crossing reduction and no
routing around nodes. Edges that skip layers pass behind the nodes between
their ends, and in a single column they are hidden completely; a long edge
between adjacent layers enters the target layer from the side and runs
behind its other nodes. Measured in EVALUATION.md (F-4): 0 of 3 edges in
the sample, 8 of 52 in a 6×10 layered graph, 49 of 90 hidden in a
single-column graph, 116 of 122 with 120 dependents on one hub. Label
wrapping counts characters, not rendered widths; wide layers need
horizontal scrolling (224px per node). Architecture views are covered in
§6.1.3. The text version is the complete account in each case, and in an
interactive document the selected node's details list its relationships
whether or not they are visible in the drawing.

**Escaping.** All markup is built with the `html` tagged template
(`src/render/escape.js`). Literal template text is trusted markup;
every interpolated value is escaped (`& < > " '`) unless it is a fragment
`html` built itself. Manifest ids used in `id`/`href` attributes are
escaped the same way. So no manifest string, excerpt or stale message can
create a tag, attribute, event handler, script, comment, or the
`<!-- featurelens` marker. The renderer emits no comments at all.

#### 6.1.2 Flow, sequence, state and data-flow diagrams (Phase 3B)

**Scope.** All four types were already in schema 1.0.0 and in the
validator (`src/validation/visualizations.js`): execution flows (`start`,
`steps[]` with `next[]`), sequences (`participants[]`, ordered
`messages[]`), state machines (`states[]` with `initial`/`terminal`,
`transitions[]`) and data flows (`nodes[]` with a `kind`, `flows[]`). Each
has enough structure to draw, so **no schema change** was needed. What the
schema does not have is not drawn and not inferred: execution-flow inputs
and outputs, transition actions, timing, concurrency beyond the `async`
message kind, and persistence beyond the `store` node kind.

**Shared infrastructure, separate semantics.** The Phase 3A `DiagramModel`
is built around impact (`direct`/`derived` nodes, `level`, `changes`,
derived edges with `via`). Forcing these types into it would lose their
meaning (message order, branch conditions, declared initial and terminal
states, data vs. processing nodes), so each type has its own model,
tagged by `type` (`src/analysis/flow-models.js`):

```
ExecutionFlowModel { type: 'executionFlow', id, title, start,
  steps: { id, label, component?, certainty, evidenceIds, start, decision, end }[],
  links: { id, source, target, condition?, claimOf, certainty, evidenceIds }[] }
SequenceModel      { type: 'sequence', id, title,
  participants: { id, label, component? }[],
  messages: { id, index, source, target, label, kind, self, certainty, evidenceIds }[] }
StateMachineModel  { type: 'stateMachine', id, title, subject?, initial, terminals,
  states: { id, label, initial, terminal }[],
  transitions: { id, index, source, target, trigger, guard?, self, repeats?, certainty, evidenceIds }[] }
DataFlowModel      { type: 'dataFlow', id, title,
  nodes: { id, label, kind, component? }[],
  flows: { id, index, source, target, data, self, certainty, evidenceIds }[] }
```

What they share with Phase 3A: `DiagramError` (turned into `RenderError`,
so the `render` command refuses instead of drawing part of a diagram), the
claim check (known certainty, every evidence id in `manifest.evidence`,
`observed`/`inferred` cite evidence), the duplicate rule (a repeated node
id is dropped when identical and refused when it differs), the layered
layout, label wrapping and arrow geometry of `src/render/diagram.js`, and
the evidence links of the text version. The drawing of each type is in
`src/render/flow-diagram.js`.

**Type-specific semantics.**

| Type | Nodes | Edges | Order |
|---|---|---|---|
| Execution flow | Steps, each a claim. `start` is the declared start step; a step with two or more `next` links is a *decision*; a step with none *has no next step* (the schema's terminal step). | One link per `next` entry, labelled with its `condition`. A link has no claim of its own: it is part of its step's claim, so it shows that step's certainty and evidence (`claimOf`). | Steps in manifest order. The text version says so: execution order is given only by `start` and the links, never by list position. |
| Sequence | Participants (declarations, no claim). | Messages, each a claim with a `kind` (`call`, `return`, `async`, `event`). Self-messages are drawn as a loop on the lifeline. | Message order is manifest order and is never changed. No timing or concurrency is implied beyond the `async` kind's name. |
| State machine | States (declarations, no claim). Initial and terminal only where declared. | Transitions, each a claim, labelled `trigger [guard]`. A transition identical to an earlier one (same ends, trigger and guard) is kept and marked as repeating it. | Manifest order. Nothing says a state is reachable. |
| Data flow | Nodes with their declared kind: `source`, `process` (processing), `store` (the only kind described as holding data), `sink`, `external`. No claim. | Flows, each a claim, labelled with its `data`. Repeated data labels stay separate flows. | Manifest order. |

**Ids.** Nodes keep their manifest ids. Edges have no id in the schema, so
the model names them by position: `next:<step>/<n>`, `message:<n>`,
`transition:<n>`, `flow:<n>` (1-based). `:` is not allowed in manifest ids,
so these can't collide with one, and they only change when the manifest's
order does.

**Direct vs. derived.** None of these types has a derived relationship:
every step, link, message, transition and flow is declared in the
manifest, and FeatureLens computes nothing for them (no reachability, no
transitive flow, no implied order). Declared items keep their own
certainty and evidence; a step's component or a participant's component
is named, but its evidence is not borrowed.

**Evidence and stale state.** As in §6.1.1: the SVG says `N source(s)`,
`no evidence` or `unverified`, never "verified"; an item citing stale
evidence gets the `unverified` class and the word "unverified" in its
text; the text version links evidence with the document's `refs`, so
stale links carry the badge and point to a catalog entry without code.
Evidence-free claims (`proposed`, `unknown`) say `no evidence`.

**Layout.** Execution flows, state machines and data flows use the
layered layout of §6.1.1, starting its depth-first walk at the start step
or initial state so they sit on the first layer; cycles are set aside the
same way and never traversed twice. When edges carry labels the gap
between layers is 96px instead of 56px. A label sits on its line in the
gap next to the source node (below it, or above for an edge going up),
wrapped to two lines of 20 characters; each gap has two label rows, and a
label takes the row nearest its source where it overlaps no label already
placed, left to right (a deterministic check on estimated widths).
Opposite edges between two nodes put their labels on either side.
Self-loops are drawn as a small loop at a node's lower-right corner; the
graph reserves room for it. Parallel edges between the same two nodes share
one line whose label shows the first and a count ("+1 more"); the line's
`<title>` and the text version list each. Sequences are drawn as columns
(one lifeline per participant, in manifest order) and one row per message,
top to bottom in message order: the number is drawn beside the sender, the
label above the arrow, and the line style gives the kind (call: solid,
filled head; return: dashed, open head; async: solid, open head; event:
dotted), with the kind also written after the label and in the text version.

**Shapes are never the only signal.** A start step and an initial state
have a thick border, a decision has pointed ends, a terminal state a double
border, a data store a bar on its left, processing rounded corners; each
also says what it is in its text. An edge citing stale evidence is dotted and
warm-colored, and its label ends with " · unverified" (a sequence message
keeps the line style of its kind, turns warm-colored and gets the same
suffix); a step citing it says "unverified" in its status line.

**Narrow screens.** Every diagram sits in its own `.diagram-scroll`
container. These four types scale down to fit only up to 360px
(`FLOW_FIT_WIDTH`: one column of nodes, or two participants); wider ones
keep their size and scroll inside the container, because scaling a 448px
diagram to a 390px screen takes 11px labels below 8px. Checked in headless
Chrome at a true 390px viewport with the sample: the page stays 375px wide
(no horizontal page scroll), the 448px execution flow, 1032px sequence and
672px data flow scroll in their containers, the 248px state machine is
drawn at full size, text in the new diagrams stays at 12–13px, and light and
dark mode both use the page's color variables.

**Text version.** Every diagram is followed by a legend and a text version
that lists every node and every edge with its certainty and sources:
steps and links (with conditions and whose claim a link belongs to),
participants and numbered messages, states and transitions (with
repeats), nodes and flows. It states what is missing (no terminal state
declared, a decision without conditions, no messages).

**Known limitations.** The same as §6.1.1 (no crossing reduction, no
routing around nodes, character-count wrapping) plus: edge labels of many
edges leaving one node can overlap, and a label on a long edge can sit
close to another edge; parallel edges show one label; self-loop labels are
not drawn (the node says how many self-loops it has, and the text version
lists them); sequences with many participants are wide and scroll inside
their container. The text version is always complete.

#### 6.1.3 Architecture layout and group boxes (Phase 3C)

**Scope.** Architecture views only. The impact diagram and the four
Phase 3B types keep their layout and output byte for byte; they don't call
any of this. No schema change, no dependency, no script, and the CSP is
unchanged.

**Group contract.** Everything comes from the view as declared; the
renderer infers no membership from code, names, paths or kinds.

- *What a group is.* An entry of the view's `groups[]` (`id`, `label`).
  It is the author's way of organizing the view: not a claim, so it has no
  certainty and no evidence, and it does not by itself mean a runtime,
  deployment or process boundary. The legend and the text version say so.
- *Membership.* A node is in a group when its view entry names it
  (`nodes[].group`). The schema gives a node at most one `group`, so a
  node is in **at most one** group; `buildDiagram` refuses a model that
  puts a node in two (only a hand-built one could). Nodes without
  `group` are ungrouped and drawn without a box, like any other node.
- *Ids and labels.* The view's group id and label, unchanged. The id
  appears only in the text version (`<code>`), never in the SVG, which
  has no ids. A view repeating a group id with a different label is
  refused (validation already reports the repeat as `id.duplicate`).
- *Order.* Groups keep declaration order in the model, in the layout's
  group list and in the text version. Left-to-right placement starts from
  declaration order and may change under crossing reduction (below).
- *Evidence.* Membership changes nothing about a node: it keeps its
  component's certainty and evidence. A group box adds no source, no
  certainty and no "verified" state.
- *Model.* `architectureDiagram` adds `groups: [{ id, label, nodeIds }]`
  (node order) to the model; a node still carries its group's `label` in
  `group`, and `buildDiagram` checks the two agree. The impact model has
  no `groups` field, which is how the renderer tells them apart.
- *Empty groups.* A declared group with no node in the view gets no box
  (a box around nothing would claim space for nothing); the text version
  lists it with "No node of this view is in this group".

**Layout** (`src/render/architecture-layout.js`, pure geometry):

1. *Layers*: `assignLayers`, as everywhere (cycles broken by the
   depth-first walk in node order, self-loops ignored).
2. *Rows of blocks*: a block is an ungrouped node, or one group's nodes on
   that layer. A group spans every layer from its first node's to its
   last node's and holds a block on each of them, even a layer where it
   has no node, so nothing else can be placed inside its box. All groups
   keep one left-to-right order in every row.
3. *Ordering*: start from manifest order (nodes in view order, groups in
   declaration order). Then at most `MAX_ITERATIONS` (4) iterations of a
   barycenter heuristic: a sweep down the layers and one up; in each layer,
   nodes inside a group block, and then the blocks of the row, are sorted
   by the mean x of their neighbors on the layers already swept, ties
   broken by current position; then groups are re-sorted by the mean x of
   their outside neighbors, ties by current order. Every edge counts
   once per pair of nodes (parallel and opposite edges don't weigh more;
   self-loops don't count; edges that skip layers use their far end).
   Crossings (straight lines between node centers that properly cross,
   lines sharing a node never counted) are counted in manifest order and
   after every iteration; the ordering with the **fewest** is kept, the
   earliest on a tie. So the result never has more crossings than
   manifest order, keeps manifest order when nothing is gained, and stops
   early at zero crossings or when an iteration changes nothing.
4. *Coordinates*: every block is placed as far left and as far right as
   the spacing (24px) and the one-x-per-group rule allow (two longest-path
   passes over the row constraints, which have no cycle because groups
   keep one order), and takes the midpoint. A row with no group is
   centered, so a view without groups and without crossings to remove
   gets exactly the Phase 3A coordinates. A group's nodes are centered
   in its box, which is 10px (`GROUP_PAD`) wider than its widest layer on
   each side, with a 20px heading band (`GROUP_HEADER`) on top. Layers are
   64px apart when there are boxes (room for a box bottom, a gap and the
   next heading), 56px otherwise.

*Cost*: for V nodes, E edges, L layers and G groups, each iteration is
O(L·(V + E + L·G)) for the sweeps (placement is redone after each layer)
plus O(E²) to count crossings; iterations are capped at 4. Above
`MAX_PAIRS` (1500) distinct drawn node pairs the heuristic is skipped
and manifest order kept. A 400-node, 700-edge, 12-group view lays out in
about 0.3s. This is a heuristic: it reduces crossings, it does not
minimize them, and the count is of straight center lines, not of the bent
lines actually drawn.

**Drawing.** Group boxes first (a rounded rectangle, no fill, so they hide
nothing), then edges, then group headings, then nodes. A heading is drawn
over the edges with the page-colored halo edge labels use, so a line
crossing the heading band doesn't cover it; arrowheads end at node
borders, below the band. The heading is cut to fit its box (a
conservative 9px per character, with "…"); the full label is in the box's
`<title>` and the text version. A grouped node's status line names its
group and is cut at 26 characters; the node's `<title>` has it in full.
Groups are told apart by their heading text and box outline, never by
color. The SVG `aria-label` adds "N group(s)".

**Edges.** Same semantics as §6.1.1: one line per source, target and
basis, with every parallel relationship in its `<title>`; opposite edges
side by side; self-loops listed in the text version, not drawn; nothing
merged or dropped, and nothing drawn as evidence-backed that isn't. One
bounded routing improvement: an edge that skips layers and whose straight
line would pass behind a node on a layer in between is bent through the
nearest gap between that layer's nodes (or beside them), one vertical
pass per layer skipped (`bendsAround`, O(layers skipped × nodes on
them)). A straight line that is clear stays straight. Opposite bent edges
are 5px apart.

**Text version.** As before, plus a *Groups* list: every declared group in
declaration order with its id and its nodes (or that it has none), a
line saying groups are not claims, have no evidence and are not by
themselves runtime, deployment or process boundaries, and the nodes in no
group.

**Narrow screens.** Unchanged rules: `.diagram-scroll` with
`overflow-x:auto`, `fit` up to 480px (`FIT_WIDTH`), otherwise `wide`.
Checked in headless Chrome at 1280px and a 390px viewport, light and dark,
with the sample and five stress views (8 groups; 180-character unbroken
and long worded group and node labels; disconnected components; a
six-node wide group; cycles, parallel, opposite and self-loop edges, an
empty group and skip-layer edges): the page is never wider than the
viewport; the sample (712px), many-groups (1952px), disconnected (1160px)
and wide-group (1364px) views scroll inside their containers; the 244px
and 468px views fit; every heading fits its box; no node is partly inside
a box, and no two nodes overlap; heading and label text use `--fg` in both
color schemes.

**Known limitations.** Crossings are reduced, not minimized; groups that
share layers can still force crossings no ordering avoids. Only skip-layer
edges that would pass behind a node are bent; other lines are straight and
can still cross a group heading (the heading stays on top) or run close to
a node. The bends go through gaps between node boxes, which may be inside
a group box. Heading and status-line cuts count characters, not rendered
widths. Nested groups and multiple membership are not supported: the
schema has neither. Wide views scroll. The text version is the complete
account.

**Why architecture views stay static.** Interaction is added to the
impact diagram only (§6.1.4), whose model has a fixed meaning for every
node and edge. Architecture views and the Phase 3B diagrams stay static
for now; see §6.1.4 for why.

#### 6.1.4 Interactive impact graph (Phase 3D)

**Pipeline and insertion point.** `render` builds the page from
fragments; the impact section calls `impactDiagram(manifest)` (pure
model) and then `diagram(model, ctx)` (static SVG, legend, text
version). The smallest safe insertion point is there, at the end of that
chain: the model, the layout and every claim stay as they are, and the
renderer only (1) adds index-based `data-*` attributes to the impact
diagram's markup, (2) wraps it in one container, and (3) appends one
constant script to the page, with a CSP hash that allows exactly that
script. Nothing else in the pipeline changes.

**Opt-in, and static by default.** Interactivity is a render option,
`render(manifest, inputs, { interactive: true })`, exposed as
`featurelens render --interactive`. It is not stored in the manifest (no
schema change), so it has to be passed on every render. Without it, the
output is byte for byte what Phase 3C produced. With it, a document that
draws no impact diagram (no generated `impact` section, or nothing
impacted) is also byte-identical to the static one: no script, no CSP
change. Only the impact diagram is interactive.

**What the renderer adds in interactive mode.**

- `<div class="impact-graph">` around the impact diagram, its legend and
  its text version (one per generated `impact` section).
- On each node `<g>`: `data-node="n<i>"`, where `i` is the node's
  position in the model (manifest order). On each drawn edge `<g>`:
  `data-source`/`data-target` with the same references. On each item of
  the text version: the same attributes. These values are generated from
  model positions, never from manifest ids or labels, so no manifest
  string reaches an attribute the script reads.
- One `<script>` at the end of `<body>`: a constant string in
  `src/render/interactive.js`, identical in every document.

No JSON data block is embedded. The script reads the diagram's structure
from the `data-*` references and its text from the text version the
renderer already escaped, so there is no second copy of manifest data and
no script-context escaping to get right.

**Script and CSP.** The script is inline (the output contract is one
`index.html` plus `manifest.json`; a separate asset would change the
writer, its confinement and its verification). The CSP gains exactly one
source, the script's SHA-256 hash:

```
default-src 'none'; script-src 'sha256-<hash of the constant script>'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'
```

A hash, not a nonce: the document is a static file regenerated
deterministically, so a nonce would be either constant (worthless) or
random (breaking determinism). The hash is computed from the constant at
module load, so it is the same in every render. There is no
`'unsafe-inline'` or `'unsafe-eval'` for scripts, so inline event-handler
attributes, `javascript:` URLs, `eval` and `Function` stay blocked by the
browser even if markup were injected; `connect-src` still falls back to
`'none'`, so the script could not make network requests even if it
tried. The script itself uses no `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, `eval`, `Function`, timers with
strings, dynamic `import()`, `fetch`, `XMLHttpRequest` or `WebSocket`;
it builds DOM with `createElement`, `textContent` and `cloneNode` of
nodes the renderer already escaped. Tests check both the script text and
the hash.

**Progressive enhancement and fallback.** The static SVG, legend and
text version are rendered first and are complete on their own. The
script only adds: focusability and roles on node groups, a toolbar with a
reset button, a details panel and a status line. If the script does not
run (blocked, disabled, a hash mismatch, an old browser), none of that
exists, so there is no dead control, no focusable node that does
nothing, and the page reads exactly like the static document plus inert
`data-*` attributes.

**Interaction contract.** Everything shown comes from the static
document; nothing is inferred, filtered or ranked.

| Action | Result |
|---|---|
| Click a node, or focus it (Tab) and press Enter or Space | The node is selected (`aria-pressed="true"`). Its direct incoming and outgoing drawn relationships are highlighted, the nodes at their other ends are marked as neighbors, and everything else is dimmed. |
| Same on the selected node | Clears the selection. |
| "Clear selection" button, or Escape anywhere in the graph | Clears the selection; focus stays where it was or returns to the previously selected node. |
| Selection changes | The details panel shows the node's entry from the text version (label, kind, direct/derived badge, level and changes, certainty, sources with "unverified" badges for stale evidence), then its incoming and outgoing relationships, each as its entry from the text version (declared with certainty and sources, or derived with the relationships it follows). A status line (`role="status"`) announces "Selected X: n incoming, m outgoing relationship(s)". |

Declared and derived stay distinct in every place: derived nodes and
edges keep their dashed style and "derived" badge, and their text says
they are not claims and have no evidence. Stale evidence keeps its
"unverified" badge in the copied entries. Only *direct* relationships of
the selected node are highlighted; there is no transitive expansion, so
the highlight never adds a relationship the diagram does not draw.
Self-loops (listed but not drawn) appear in both lists, as in the text
version.

**Accessibility.** Nodes are `role="button"`, `tabindex="0"`, with an
`aria-label` taken from the node's `<title>` (label, kind, status). Focus
is shown by an outline around the node (`:focus-visible`), separate from
the selection style. Selection does not depend on color: the selected
node's border is 4px and the other nodes and edges are dimmed to 30%
opacity; highlighted edges get a thicker line; the details panel and the
status line say it in words. The reset button is disabled when nothing is
selected. There is no animation, so reduced-motion preferences have
nothing to reduce. The text version stays below the diagram, unchanged,
as the static fallback and the complete account.

**Narrow screens.** The diagram keeps its `.diagram-scroll` container and
`fit`/`wide` classes; the toolbar and details panel are normal block
content with wrapping text, so the page does not scroll sideways.

**Why only the impact diagram.** Its nodes and edges have one fixed
meaning (direct, derived, declared, derived-following), and "what does
this touch directly" is the question a reader asks of it. Architecture
views have group boxes and bent edges whose highlighting needs its own
design; flow, sequence and state diagrams have ordered steps and
messages where "neighbors" is not the useful question. Each needs its own
interaction contract, which this phase does not attempt.

**Known limitations.** No pan, zoom, drag, search, filtering or
transitive highlighting. Parallel relationships drawn as one line are
highlighted together. The option is not remembered between renders. On a
wide diagram, a selected node's neighbors may be scrolled out of view;
the details panel lists them. SVG focus outlines depend on the browser's
support for `outline` on SVG elements (current Chrome, Firefox and
Safari).

#### 6.1.5 Documentation layout and presentation modes

The page is a small documentation app. What it claims is unchanged: the
same sections, claims, certainty, evidence, diagrams and derived impact,
from the same manifest, with no schema change. Only how they are arranged,
worded and disclosed changed.

**Pages.** `render` wraps the document in a shell (`layout.js`): skip
links, a top bar (`role="banner"`: product name, feature, repository and
branch, mode), a sidebar, `<main>` with the pages, and the footer. Page 0
is the overview (`overview.js`); every other section is a page of its own,
in manifest order, followed by the unknowns and evidence appendices when
no generated section of that kind exists. The first section is embedded in
page 0 when it is an `overview` section. Each page is
`<div class="page" id="page-N">` holding one unchanged
`<section id="section-…">` (or appendix), then previous/next links.

**Sidebar and reading order.** Section kinds map to fixed groups:
overview (overview, scope), architecture (architecture, implementation,
impact), behavior (flows), quality (risks, testing, unknowns), notes
(custom) and reference (references, history). A group appears only when a
page is in it; the sidebar lists groups in that order, pages in document
order within a group, and under each page the diagrams it anchors. That
reading order drives previous/next. The document order stays manifest
order, as before.

**Navigation without script.** The URL hash picks the page. For each page
index N the stylesheet gets rules of the form

```css
body:has(#page-N:target,#page-N :target,#menu-N:target) #page-N{display:block}
```

(and the same selector for the sidebar highlight, the skip link and, below
62rem, the menu button), inside `@supports selector(:has(*))` after
`.page{display:none}`. Page 0 also matches when nothing in a page, and no
drawer link, is the target, so no hash or an unknown one shows the
overview. Any anchor inside a page (a finding, a diagram, an evidence
entry) therefore opens its page, and history, refresh and bookmarks work
as for any anchor. Only ids of the form `page-N`, `menu-N` and `back-N`
reach the stylesheet; manifest ids never do, so manifest text cannot
affect CSS (`test/layout.test.js` checks that hostile titles and ids
leave the stylesheet byte for byte the same). Without `:has()` the whole
block is dropped and every page shows, one after another: the static
document. Print shows every page.

**Mobile drawer.** Below 62rem the sidebar's links are hidden. The top
bar shows one menu link, the current page's: `#menu-N`. `menu-N` is a
"Close menu" link at the top of the sidebar; when it is the target it
becomes a fixed header and opens the sidebar next to it as a fixed
drawer, and page N stays current. It links to `#back-N`, a fixed-position
empty anchor at the top of page N, so neither opening nor closing
scrolls. Following any link in the drawer changes the target and so
closes it. Fragment navigation moves the browser's sequential focus
starting point to the target, so Tab after opening the drawer reaches its
first link, and Tab after the skip link (`#back-N`) reaches page N's
content.

**Modes** (`presentation.js`, `render(…, { mode })`, `render --mode`).
`developer` (default) and `product` share every code path; the mode picks
labels (certainty words, group names, list headings) and which details
start collapsed in `<details>`: in product mode, each claim's sources and
certainty definition (Technical details), component details,
relationships, relevant files, declared and derived impact lists, history
and code excerpts. The overview shows "Where it lives" (entry points,
primary files, configuration components and configuration evidence) in
developer mode, and "How it works" in product mode: the first execution
flow's steps breadth-first from `start`, with branch conditions (else the
first sequence's messages in order). Diagram text versions are collapsed
in both modes, except the impact diagram's in developer mode, which the
interactive graph's text lies next to. No manifest text is rewritten,
shortened or added to. `test/layout.test.js` checks that both modes
contain every claim's text, the same source links and the same evidence
anchors.

**What did not change.** `render` with no options still returns a page
with no script and the same CSP; `--interactive` still adds exactly the
impact graph script (the interactive tests compare the two renders
unchanged). Section ids and classes, claim heads, source links
(`#evidence-…`), evidence anchors, diagram markup and the impact graph's
data references are as before, so links into a page from elsewhere keep
working; findings, components, risks, unknowns and diagrams gained anchors
of their own. The only elements added
to the allowed set are `details`, `summary` and `strong`.

### 6.2 The `render` command

```
featurelens render <manifest.json> --repo <dir> --excerpts <file> [--acknowledge <evidence-id> ...] [--mode developer|product] [--interactive] [--json]
```

**Boundary.** Excerpts cross from Claude Code to FeatureLens as a file:

| Step | Who | What |
|---|---|---|
| Collect | Claude Code | Reads each current evidence entry's lines with its own tools and writes them as a JSON array of `SourceExcerpt` (MANIFEST.md, "Excerpt file"). |
| Receive | CLI | `loadExcerptFile` (`src/docs/store.js`) checks only the shape: an array of objects with exactly the five keys and the right types. |
| Validate | CLI | `indexInputs` (`src/render/inputs.js`) checks each excerpt against the manifest: known id, one per id, same location, same line count, `sha256(text) = snippetHash`, not stale. |
| Render | renderer | `render(manifest, { excerpts, stale })`, pure. |

The CLI never reads a source file to produce or complete an excerpt.
Missing excerpts are shown as "no excerpt". The only source reads in a
`render` run are validation's (`SourceTree`, the cited files), as in
`validate --repo`. Validation has confirmed that every current entry's
`snippetHash` matches the repository, and each excerpt must hash to that
same value. So an accepted excerpt *is* the current code, without the CLI
reading it again. The excerpt file can only repeat what the manifest says,
so it can't become a second source of truth.

**Sequence.** Each step either passes or ends the run with a refusal.
Nothing is written before step 6:

1. Parse arguments. `--repo` and `--excerpts` are required (exit 2), so
   evidence is always checked and excerpts are always explicit.
2. `loadManifestFile` (exit 1 if unreadable).
3. `validateManifest(manifest, { repoRoot })` (exit 1 if invalid).
4. `checkWriteGate(result, { acknowledged })` on that same result. Exit 3
   if it refuses stale evidence. `--acknowledge` ids that are not
   `manualOnly` stale entries have no effect and are reported.
5. `loadExcerptFile` and `indexInputs` (exit 1), then `loadConfig` for
   `outputDir`, then `render(manifest, { excerpts, stale: result.stale }, { interactive })`
   (`--interactive`, §6.1.4).
6. `writeFeatureDocument(target, { manifest, html })`: path confinement,
   existing-output check (§7), stamping, `index.html`, verification,
   `manifest.json` last. Refused output exits 1 with its code.
7. Report the files written, the existing-output state (a `history-mismatch`
   is printed as a note) and any evidence without an excerpt. Exit `3` if
   acknowledged stale evidence remains, else `0`.

The writer stamps the marker (`stampDocument`); the command never stamps
or writes on its own. `--json` prints one object:
`{ exitCode, written, manifest, interactive, validation, gate, excerpts,
notes, output, existing, refused? }`, where `refused` is `{ step, message, code? }` and
`step` is `manifest`, `validation`, `write-gate`, `excerpts`, `config`,
`render`, `existing-output` or `output`.

There is no `--force` flag. `writeFeatureDocument` supports `force`, but
exposing it needs its own confirmation design (§7). Until then, refused
output stays untouched.

**The plugin.** `.claude-plugin/plugin.json` declares the plugin,
`.claude-plugin/marketplace.json` makes the repository a one-plugin
marketplace for `/plugin install`, and
`skills/featurelens/SKILL.md` is its only component. The skill describes
the whole workflow for Claude Code: scope, inspection with its own tools,
writing the draft, `build`, collecting excerpts, `render`, exit codes,
stale handling, refused output, and updates (copy the existing manifest,
`validate`, revise, `update`, `render`). Every step is a CLI command;
Claude writes no scripts. It calls the CLI as
`node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js"`, written out in full in
every command (Claude Code substitutes the plugin root into the skill text
when it loads the skill; it is not a shell variable). `claude plugin validate .`
checks the plugin format. `test/plugin.test.js` checks that the skill
matches the CLI: commands and flags exist, library functions exist, the
excerpt example is accepted against the sample manifest, and the output
path and exit codes agree.

## 7. Updating existing documents

Before touching an existing `<outputDir>/<feature.id>/`, every write checks
what is there (`checkExistingOutput` in `src/output/existing.js`, called by
`writeFeatureDocument`). "Existing" means the files on disk, compared with
each other, not with the manifest about to be written:

| Found | Code | Behavior |
|---|---|---|
| Nothing | `absent` | Write. |
| `manifest.json` only, no `index.html` | `html-absent` | Render it; there is nothing to lose. |
| Intact marker (valid hash) matching `manifest.json`'s feature id, schema version and last history id | `in-sync` | Regenerate. |
| Intact marker, but its `historyId` ≠ `manifest.json`'s last history entry | `history-mismatch` | Regenerate from `manifest.json` and report the two ids. The hash proves the HTML is untouched generated output, so nothing is lost; this is the state an interrupted write leaves. |
| No marker, marker not on line 2, more than one, malformed or invalid | `marker-*` | Refuse: not a FeatureLens document, or damaged. |
| Marker hash mismatch (HTML edited after generation) | `hash-mismatch` | Refuse, whatever its `historyId`. |
| Marker or `manifest.json` for a different feature id | `feature-id-mismatch` | Refuse: the folder belongs to another feature. |
| Intact marker with a schema version ≠ `manifest.json`'s | `schema-version-mismatch` | Refuse; only the history-id mismatch has a defined recovery. |
| `index.html` (even intact) without `manifest.json` | `manifest-missing` | Refuse: its source is gone and the HTML is the last copy. |
| `manifest.json` that isn't JSON or lacks `schemaVersion`, feature id or history | `manifest-unreadable` | Refuse. Full validation of the existing manifest is the caller's job (`validateManifest`), before rendering. |
| Otherwise safe output, but the new manifest's `history` is not the existing `manifest.json`'s history followed only by new entries | `history-regression` | Refuse. `historyRegression.reason` is `older` (a strict prefix: an older state), `replaced` (none of the existing entries: a new document over an existing one), `removed`, `reordered` or `modified` (with the first diverging `index` and `entryId`). Entries are compared by content, key order ignored. Identical histories and strict append-only extensions are allowed. The feature id remains the only identity check, so a different history for the same feature is never treated as "another document". |
| Otherwise safe output, but a manual section of the existing `manifest.json` is changed (anything but `provenance`) or removed, and no new history entry lists it in `changedSections` | `manual-section-changed` | Refuse; `manualSections` names them. Manual content changes only when the user asks, and `update --edit-manual` records that. Checked after `history-regression`. |

On refusal, the options are: create a **new baseline** (a fresh analysis
written to a new feature folder), or **replace** the existing files with
`force` (`writeFeatureDocument(…, { force: true })`, library only: the
CLI has no `--force`, so CLI users render under a new feature id or move
the folder aside themselves). Force exists because refusal would otherwise be permanent for
a folder whose HTML can't be trusted; it discards whatever is in the old
files, so Claude must say that and get explicit confirmation first. Only
the literal `true` enables it, and the result reports `forced: true` with
the refusal code it overrode. FeatureLens never parses, merges or
preserves unknown HTML.

The update itself (`featurelens update`, §2):

1. `validate --repo` on a copy of the existing `manifest.json` lists the
   `stale` evidence, the claims that cite it and the sections that show it
   (`sectionsCitingEvidence`). Freshness comes from `snippetHash`, so it
   works without git, in shallow clones, and when the recorded revision no
   longer exists.
2. Claude resolves each entry in the copy: `relocate` moved evidence,
   `reanalyze` the code behind changed or missing evidence and revise the
   claims, removing the entry's `snippetHash` so `update` re-stamps it,
   and bring `review` entries to the user. Claude also uses its own git
   tools to find new code the document should cover.
3. `update` reads the existing `manifest.json` itself (resolved inside the
   repository), re-validates it to get its stale entries, stamps evidence
   without a hash, and checks the copy's structure. `planUpdate` then
   refuses a copy that changes the history or the feature id, or changes,
   adds or removes a manual section not named with `--edit-manual`, and
   computes `changedSections` deterministically: new sections; sections
   whose own content, placed findings or listed visualizations changed;
   generated sections whose kind's analysis data changed; and generated
   sections that show touched evidence (stale in the existing manifest, or
   added, removed or edited), in both manifests. Each comes with reasons.
   Manual sections affected but not changed are reported as
   `manualToReview`, not included. The `history` kind is never included.
4. `recordUpdate` appends the entry (git user, `previousRevision` →
   current revision, `--changed-file`, `changedSections`) after branch,
   remote and dirty are refreshed from git; its validation result goes
   through `checkWriteGate` (with `--acknowledge` for manual-only stale
   entries), and the result is written to `--out` only.
5. `render` renders the whole document and writes both files through
   `output/writer`, which refuses the manifest if its history does not
   extend the existing `manifest.json`'s (`history-regression`) or it
   changes a manual section without recording it (`manual-section-changed`).

## 8. Attribution and provenance

- Every person record has a `source`: `git-config`, `git-log`, `github-api`,
  `user-provided` or `unknown`.
- `git config user.name` is a display name. It is **never** presented as a
  GitHub username. `githubLogin` is only set from an authenticated GitHub
  source or from explicit user input.
- Emails are **omitted by default**. They're included only when
  `.featurelens.json` sets `attribution.includeEmail: true`.
- Remote URLs have `user:token@` stripped before they're recorded.
- Contributors are **commit authors** (`git log --format=%aN %aE`, with
  `.mailmap` applied) of the cited evidence files, so they reflect who wrote
  the analyzed code, not the whole repository. Committers are not recorded.
- Anything that can't be resolved stays explicitly `source: "unknown"`.

## 9. Security posture

- Read-only analysis. FeatureLens does not modify application source code.
- Git runs through `execFile` (no shell).
- Evidence and output paths are confined to the repository after resolving
  symlinks. The schema rejects absolute, `..`, backslash and drive-letter
  paths before any file is touched.
- Output directories from config must be relative and inside the repository.
- Nothing in `src/` or `bin/` imports a network module or contains an
  external URL (`test/boundaries.test.js`). Generated HTML escapes all
  data, links only to anchors inside the document, and forbids loading
  anything with a Content-Security-Policy (`test/render.test.js`). Its
  navigation is CSS built from page indexes, never from manifest text
  (§6.1.5). It has
  no scripts, except the one constant impact graph script of
  `render --interactive`, which the CSP allows by hash and nothing else;
  it embeds no data and builds no markup from strings (§6.1.4,
  `test/interactive.test.js`).

## 10. Key decisions

| Decision | Alternatives | Reasoning |
|---|---|---|
| Plain ESM JavaScript, Node ≥ 20, zero runtime deps, JSDoc types | TypeScript + build; ajv | A Claude Code skill runs scripts in place, so no install or build step keeps it reliable. The cost is a small hand-written schema validator, and it has tests. |
| Claude does the analysis; the library does no static analysis | tree-sitter / language servers | Works on any stack from day one. Language-specific analyzers can be added later as optional evidence providers that emit the same `SourceRef`s. |
| One typed shape per visualization, all optional | One generic nodes-and-steps "flow" shape (the v0.1 draft) | Each diagram type has its own rules (one initial state, a start step, edges inside a view). Separate shapes let the schema and validator enforce them, and a feature includes only the diagrams that fit it. |
| Architecture views reference components and relationships by id | Separate node and edge lists | The dependency graph is analysis data. A view only chooses and groups, so the two can't disagree. |
| Section provenance points at a history entry | Per-section author and timestamp fields | One source of truth: the history entry already has who, when, revision and tool version. |
| Evidence carries a required `snippetHash` of the cited lines | Line numbers only; optional hash | Detects cited code that changed or moved, without git. Required because a missing hash makes staleness undetectable. |
| Stale evidence is a separate result (`moved`/`changed`/`missing`/`ambiguous`, exit 3), not an error or a warning | Error (v0.2); warning | An error made every document invalid as soon as its code changed, so render and update could never start. A warning would let outdated docs pass silently. A separate state keeps CI strict and gives updates a work list. |
| Companion `manifest.json` + self-hashed HTML marker; whole-document regeneration | Manifest embedded in HTML only; per-section `contentHash` and HTML merging | No HTML parser. Hand edits are detected with one hash and refused; out-of-sync files are detected with one id. |
| Valid hash + `historyId` mismatch regenerates (and reports) instead of refusing | Refuse (the Phase 1 draft) | `manifest.json` is written last, so this is exactly what an interrupted write leaves. The hash proves nothing hand-written is lost, and refusing would make every interrupted write need `--force`. |
| `manifest.json` written last | HTML last | The manifest is the source of truth; it only moves forward once its HTML is on disk and verified. |
| Excerpts are caller-supplied `{ evidenceId, file, startLine, endLine, text }`, checked against `snippetHash` | Renderer reads source; excerpts stored in the manifest; id-to-text map without a check | Keeps the renderer pure and the manifest free of copied code. The hash check means a wrong or outdated excerpt can't be presented as the cited code. |
| Manual sections never show generated analysis data | Render a manual section's `kind` data like a generated one | Keeps "written by a person" literally true for everything in a manual section. |
| Static renderer with no scripts | Inline JS for interactivity now | Nothing in this phase needs script. No script means no script-context escaping and a strict CSP. |
| Documentation-app navigation with `:target` and `:has()`, no script | A constant navigation script allowed by hash; a SPA framework; one long page with a sidebar | Static pages keep having no script, so the security model and CSP don't change, and the layout works where scripts are blocked. The hash already gives history, refresh and bookmarks. The cost is no search, no scroll-position highlight and no Escape for the drawer. One long page couldn't give the overview-first reading path. |
| One page per section; the sidebar groups by kind, the document keeps manifest order | Merge sections into topic pages; reorder the document by group | A section is the author's unit and its anchors are stable. Grouping only in the sidebar keeps manifest order (which tests and authors rely on) and still gives a coherent reading path. |
| Presentation modes choose labels and disclosure, not content | Separate renderers; summarizing or rewording claims for product readers | Both modes stay a view of the same evidence-backed claims; rewording would be new, unevidenced text. |
| Interactive impact graph is opt-in, progressive enhancement of the static diagram (Phase 3D) | Always on; a separate interactive renderer; a graph library | Default output stays byte for byte the same, and the static diagram and text version remain the complete account when script is off. One code path draws both. |
| One constant inline script allowed by its SHA-256 hash | A nonce; `'unsafe-inline'`; a separate `.js` asset | A nonce is either constant or random in a static, deterministic file; `'unsafe-inline'` would also allow injected handlers; an asset would change the writer's two-file contract and its confinement. A constant script gives a constant hash. |
| The script reads index-based `data-*` references and copies the escaped text version | Embed the model as JSON in a `<script type="application/json">` | No second copy of manifest data and no script-context escaping; manifest strings never reach an attribute or string the script interprets. |
| Only direct relationships of the selected node are highlighted | Transitive paths; filtering; ranking | Direct relationships are what the diagram draws; anything more would be a new claim about reach that the manifest doesn't make. |
| Browser tests drive headless Chrome over the DevTools protocol with Node's built-in WebSocket | A browser test dependency (Playwright, Puppeteer, jsdom) | Keeps zero dependencies; a fake DOM wouldn't test the CSP, focus or computed styles. |
| Without Chrome, each browser test is reported as skipped; `FEATURELENS_REQUIRE_BROWSER=1` (`test:browser`, `check:release`) makes that a failure (Phase 3E) | Skip the suite as a whole; always require Chrome | Skipping the whole suite hid 11 tests from the counts, so a run without browser coverage looked complete. Always requiring Chrome would make local development depend on a browser. Per-test skips keep the gap visible; the required mode is for CI and releases. |
| Static SVG diagrams from a pure model built from existing manifest data (Phase 3A) | A graph library; an interactive graph now; new schema fields for diagram layout or edges | No dependency, script or CSP change. The manifest already has components, relationships, impact items, impact relationships and architecture views, so no schema change is needed. A pure model keeps layout and HTML out of the engine and makes the rules testable (derived never cites evidence, direct never becomes derived). Interactivity waits until the static contract is settled. |
| Diagram order is manifest order; layout is a simple layered one | Sorting by id; a full Sugiyama layout | Matches the rest of the renderer (authors control order) and stays deterministic. Crossing reduction and edge routing are complexity the text version makes up for; architecture views gained a bounded version in Phase 3C (§6.1.3), manifest order still being the starting point and tie-breaker. |
| One typed model per Phase 3B diagram type, sharing the claim check, duplicate rule, layout and arrow geometry | Map every type onto the impact `DiagramModel`; one generic node-edge model | The impact model's fields (`impact`, `level`, `changes`, `via`) mean nothing here, and a generic model would lose message order, branch conditions, declared initial and terminal states, and data vs. processing nodes. No schema change was needed: the types were already in schema 1.0.0. |
| A `next` link shows its step's certainty and evidence | Give links no claim; add claims to `next` in the schema | The schema makes `next` part of the step, so the step's claim is the one covering it. Saying so (`claimOf`, "part of the claim of step …") keeps it honest without a schema change. |
| Architecture groups come from `groups[]`/`nodes[].group` only and carry no claim | Infer groups from paths or kinds; give groups evidence; draw groups as runtime boundaries | Membership is the author's organizing choice, already in schema 1.0.0. Inferring it would be a claim with no evidence; calling a box a boundary would claim more than the manifest says. |
| Bounded barycenter ordering, best-of by crossing count, manifest order on ties (Phase 3C) | Full Sugiyama with dummy nodes; a layout library; exact minimization | No dependency, deterministic, and never worse than manifest order. Exact minimization is NP-hard; a fixed number of iterations and a pair cap keep large views predictable. |
| Group blocks on every layer a group spans, one group order in all rows, midpoint of the leftmost and rightmost placement | Bounding boxes around wherever members land; one column per group | Boxes can never contain a non-member or overlap, groups on different layers can share columns, and views without groups keep their Phase 3A coordinates. |
| Phase 3B diagrams fit only up to 360px, otherwise scroll | Reuse the 480px `FIT_WIDTH` | At 390px a 448px diagram scales to about 70%, which takes its 11px edge and message labels below 8px. Impact and architecture diagrams keep 480px, so their output is unchanged. |
| Claude Code does repository inspection and git investigation; FeatureLens has no file discovery or change listing | `listSourceFiles`, `getChangedFiles`, `inventory`/`evidence` commands (v0.2 draft) | They duplicated Glob, Grep and `git diff` and pointed toward an orchestrator. |
| Schema 1.0.0 corrected in place (required `snippetHash`, removed `provenance.contentHash`) | Bump to 2.0.0 with a migration | Nothing had been published and no documents existed, so there was nothing to migrate. |
| Excerpts reach the CLI as an explicit file written by Claude Code (`render --excerpts`) | `render` reads the cited lines through `SourceTree` itself; excerpts inline in the manifest | Claude Code owns reading the repository, and the file keeps that visible and explicit. The hash check against `snippetHash`, which validation has just confirmed against the repository, makes a wrong or outdated excerpt impossible to present as code. Cost: Claude Code has to transcribe cited lines exactly (a mismatch is refused by id). |
| `render` applies the write gate before checking excerpts | Excerpts first | After a code change, the old excerpt file contains stale evidence. Gate-first reports the cause (exit 3, stale) rather than a symptom (exit 1, excerpt for stale evidence). Nothing is written either way. |
| `render` exits 3 when it writes a document with acknowledged manual-only stale evidence | Exit 0 because it wrote; a new exit code | Keeps 3 meaning "valid but stale" for both commands, so CI and the skill never read a stale document as current. `written` in the report tells refusal and success apart. |
| No `--force` in `render` | Expose `writeFeatureDocument`'s `force` | Discarding refused output needs an explicit confirmation design; until then refusal is safe and the skill offers a new feature id or asks the user to move the folder. |
| Issue codes on every validation error | Messages only | Programs (the skill's fix-and-retry loop, CI) and tests can act on codes, and messages can improve without breaking them. |
| Schema version gate before JSON Schema | Rely on a `schemaVersion` pattern | An unsupported version gets one actionable error instead of dozens of misleading structural ones. |
