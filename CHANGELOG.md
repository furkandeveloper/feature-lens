# Changelog

All notable changes to FeatureLens are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). The manifest schema has
its own version (`schemaVersion`), described in
[docs/MANIFEST.md](docs/MANIFEST.md#versioning).

## 1.0.0 - Unreleased

First public release. Tool version 1.0.0, manifest schema 1.0.0.

### Claude Code plugin

- The `featurelens` skill (`/featurelens:featurelens`) guides Claude Code
  through creating a document (draft → `build` → `render`) and updating
  one after the code changed (copy the existing manifest → `validate` →
  revise → `update` → `render`), including stale evidence, refusals and
  manual sections. Every step is a CLI command; no scripts are needed.
- The repository is its own plugin marketplace
  (`.claude-plugin/marketplace.json`), so it can be installed with
  `/plugin marketplace add` and `/plugin install featurelens@featurelens`.

### CLI

- `build`: stamps every evidence location in Claude's draft with a SHA-256
  hash of the cited lines (listing every location that doesn't exist),
  adds repository and person metadata from git, validates the manifest
  and applies the write gate. Refuses a feature that already has a
  document.
- `validate`: checks the schema version, JSON Schema, references, graph
  integrity, section provenance, history consistency and, with `--repo`,
  every cited location. Stable issue codes with JSON Pointers; `--json`
  output; exit code 3 for valid but stale documents.
- Stale evidence detection: `moved` (with the new location), `changed`,
  `missing` and `ambiguous` (with candidates), each with the claims that
  cite it, the generated and manual sections that show it, and the action
  it needs (`relocate`, `reanalyze`, `review`).
- `update`: compares a revised working copy with the existing document,
  re-stamps evidence whose hash Claude removed, refuses changes to history,
  the feature id or manual sections (unless named with `--edit-manual`),
  reports changed sections with a reason for each and manual sections to
  review, and appends a history entry chained to the previous revision.
- `render`: validates against the repository, applies the write gate,
  checks each source excerpt against its evidence hash, renders the page
  and writes it through the checked writer. `--interactive` adds the
  interactive impact graph; `--acknowledge` accepts stale evidence cited
  only by manual sections.
- `git-info`: repository, user and contributor metadata as JSON.
- Optional `.featurelens.json` for the output directory and attribution
  (emails are off by default).

### Documents

- One self-contained, offline `index.html` per feature next to its
  `manifest.json`, the source of truth.
- Claims labeled observed, inferred, proposed or unknown; observed and
  inferred claims must cite evidence; excerpts shown with line numbers;
  stale evidence shown as unverified, without code.
- Static SVG diagrams, each with a legend and a complete text version:
  impact (direct, declared and derived impact), architecture views with
  group boxes and deterministic crossing reduction, execution flows,
  sequence diagrams, state machines and data flows.
- Opt-in interactive impact graph: keyboard-accessible node selection that
  highlights direct relationships and shows node details.
- Deterministic output: the same manifest and excerpts give the same page.
- Narrow-screen layout and dark mode.

### Safety

- Output confined to the repository, with symlinks resolved and refused
  when they lead outside it.
- Existing output is replaced only when it is intact FeatureLens output,
  detected by a self-hashed marker. Refuses hand-edited pages, foreign
  folders, history regressions and unrecorded manual-section changes.
  There is no `--force`.
- Manual sections are protected by `update` and by the writer.
- Content-Security-Policy with `default-src 'none'`. Static pages have no
  script; interactive pages allow one constant script by hash, without
  `'unsafe-inline'` or `'unsafe-eval'` for scripts.
- No network access and no runtime dependencies. Credentials are stripped
  from remote URLs.

### Testing and evaluation

- 434 unit, integration and CLI tests with `node:test`, including 11
  headless Chrome tests of the interactive impact graph.
- End-to-end evaluation matrix (`eval/run.js`, 539 expectations) over the
  sample project, expressjs/express at three tags, and generated
  repositories up to 1,000 components ([docs/EVALUATION.md](docs/EVALUATION.md)).

### Known limitations

- Large or wide impact graphs may contain edges passing through or behind
  nodes; the text version is the authoritative fallback.
- Re-stamping changed evidence is trust-based: FeatureLens can't check
  that Claude revised the claims before removing a hash.
- `--changed-file` is supplied by Claude; FeatureLens doesn't list changed
  files itself.
- The skill has not yet been evaluated with real prompts on external
  repositories.
- Interactive pages are tested in Chrome only.
