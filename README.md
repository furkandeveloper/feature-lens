# FeatureLens

**Turn one feature of a codebase into visual, evidence-backed documentation.**

FeatureLens is a [Claude Code](https://claude.com/claude-code) plugin. You
ask Claude to document a feature ("the payment flow", or "the impact of
adding refunds"), Claude reads the code with its own tools, and FeatureLens's
bundled command-line tool checks every claim against the actual source lines
before it writes a self-contained HTML page. When the code changes later,
FeatureLens tells you which claims have gone stale and helps Claude update
the document without losing its history or anything a person wrote by hand.

> **Status: 1.0.0 (unreleased).** The build, update and render workflow,
> the validator, the renderer with all diagram types, and the plugin skill
> are complete and tested. See [Project status](#project-status) and
> [Known limitations](#known-limitations).

## Contents

- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Installation](#installation)
- [First use](#first-use)
- [The generated page](#the-generated-page): [layout and navigation](#layout-and-navigation), [developer and product modes](#developer-and-product-modes)
- [Workflows](#workflows): [build](#build-a-new-document), [update](#update-a-document-after-the-code-changed), [render again](#render-again-and-interactive-rendering)
- [Command reference](#command-reference)
- [Recovering from a refusal](#recovering-from-a-refusal)
- [Configuration](#configuration)
- [Safety and security](#safety-and-security)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Project status](#project-status) · [Contributing](#contributing) · [License](#license)

## What you get

Each document is one feature, written to `docs/features/<feature-id>/`:

- **`index.html`**: a single self-contained page that works offline, laid
  out as a small documentation app: an overview page, a sidebar that groups
  the sections, and one page per section. It has no external resources,
  and by default no script: navigation is plain links and CSS.
- **`manifest.json`**: the source of truth the page is generated from. It
  diffs cleanly in code review.

The page contains:

- **Evidence-backed claims.** Every finding, component, relationship and
  risk is labeled **observed**, **inferred**, **proposed** or **unknown**,
  and observed or inferred claims must cite source lines. Cited lines are
  shown as excerpts with line numbers.
- **An impact diagram**: direct impact, declared impact relationships, and
  derived impact, which is labeled as not a claim.
- **Whichever other diagrams fit the feature**, each as static SVG with a
  legend and a full text version:
  - architecture views, with groups drawn as boxes and a deterministic
    heuristic that reduces edge crossings
  - execution flows, with branch conditions
  - sequence diagrams, with numbered messages in order
  - state machines, with the declared initial and terminal states
  - data flows, with stores shown separately from processing
- **Two presentations of the same analysis** (`render --mode developer`,
  the default, or `--mode product`): implementation detail in the open, or
  the same claims worded for readers who need behavior rather than code.
- **An optional interactive impact graph** (`render --interactive`):
  click or keyboard-select a node to highlight its direct relationships
  and see its details.
- **Sections** for overview, scope, architecture, implementation, flows,
  impact, risks, testing, unknowns, references and history, plus **manual sections**
  that hold text a person wrote and that FeatureLens never rewrites.

Diagrams draw only what the manifest declares. FeatureLens does not infer
structure from code.

### See an example

The repository includes a small sample project with a complete manifest.
To render it into a temporary copy and open the page:

```sh
D=$(mktemp -d) && cp -R examples/sample-shop "$D/" && echo '[]' > "$D/excerpts.json"
node bin/featurelens.js render "$D/sample-shop/featurelens/payment-flow.manifest.json" \
  --repo "$D/sample-shop" --excerpts "$D/excerpts.json" --interactive
open "$D/sample-shop/docs/features/payment-flow/index.html"   # macOS; use xdg-open on Linux
```

With an empty excerpt file (`[]`), evidence is shown as "no excerpt"
instead of code. In normal use Claude supplies the cited lines.

## The generated page

### Layout and navigation

- **Overview first.** The first page answers what the feature is and where
  to go next: name, description, repository and revision, whether the cited
  evidence is current, key facts (components, findings, diagrams, risks,
  unknowns, sources), the summary section, and cards linking to key
  findings, the most severe risks, open questions and every diagram. It
  repeats no full section.
- **Sidebar.** Sections are grouped by kind: *Overview* (overview, scope),
  *Architecture* (architecture, implementation, impact), *Behavior & flows*
  (flows), *Risks & quality* (risks, testing, unknowns), *Notes* (custom),
  *Reference* (references, history). Only groups with sections appear, and
  each diagram a section shows is listed under it. The document keeps
  manifest order; the sidebar sets the reading order, which the
  Previous/Next links at the bottom of each page follow.
- **One page at a time, chosen by the URL hash.** Every sidebar link,
  evidence link and diagram link is a plain `#anchor`; the page that holds
  the target is shown and highlighted in the sidebar. Refresh, bookmarks,
  Back and Forward work, and following a claim's source to its evidence
  entry and pressing Back returns to the claim. An unknown hash shows the
  overview.
- **Mobile.** Below 992px the sidebar becomes a drawer opened by the
  **Menu** button in the top bar. It opens over the current page without
  scrolling it, closes when you follow a link, and **Close menu** returns to
  where you were.
- **Keyboard.** A *Skip to content* link comes first and jumps into the
  current page; every link, disclosure and (with `--interactive`) impact
  node is reachable with Tab and has a visible focus ring. Smooth
  scrolling is off with reduced motion.
- **No script needed.** All of this is HTML and CSS (`:target` and
  `:has()`). In a browser without `:has()`, every page is shown one after
  another as a single static document; printing does the same.

### Developer and product modes

`render --mode developer` (the default) and `render --mode product` render
the same manifest: the same claims, certainty, evidence, diagrams and
unknowns. Only wording and what starts collapsed differ.

| | `developer` | `product` |
|---|---|---|
| For | engineers changing or debugging the code | product engineers, architects, stakeholders who need behavior |
| Certainty | `observed`, `inferred`, `proposed`, `unknown` badges | "Read in code", "Inferred from code", "Proposed change", "Undetermined", with the definition in the details |
| Sources | on every claim: `file:lines` links and the cited symbol | under **Technical details** on each claim, with each source's explanation |
| Overview card | **Where it lives**: entry points, primary files, configuration | **How it works**: the first execution flow (or sequence) as numbered steps |
| Components | kind, parent, endpoint and dependency shown | name and summary; the rest under Technical details |
| Relationships, files, history, derived impact | open | collapsed, with a count |
| Code excerpts | shown | behind **Show code** |

Diagram text versions start collapsed in both modes (the impact diagram's
stays open in developer mode). Product mode never rewrites or summarizes
manifest text: the plainer reading path comes from ordering, labels and
disclosure, not from new claims. Use `product` when the reader wants to
know how the feature behaves; use `developer` (the default) when they need
to find, change or verify the code.

## How it works

FeatureLens splits the work in two:

| Work | Done by |
|---|---|
| Reading the repository, deciding what the feature is, what the code does and what a change would touch | **Claude Code**, with its own tools (Glob, Grep, Read, `git`), guided by the plugin's skill |
| Stamping evidence, validating the manifest against the repository, detecting stale evidence, recording history, rendering HTML and writing it safely | **The `featurelens` CLI**, which is deterministic and has no dependencies |

FeatureLens is not a standalone analysis engine, server or autonomous agent.
It has no network access and never inspects the repository on its own: the
analysis is Claude's, and the CLI checks it and refuses to write anything
it can't verify.

1. **Draft.** Claude explores the code and writes a draft: the feature,
   evidence locations (file and line range), the analysis, the diagrams
   that fit, and the sections.
2. **Build.** `featurelens build` stamps each evidence location with a
   SHA-256 hash of the cited lines, refusing lines that don't exist, adds
   git metadata and a history entry, and validates the result: schema,
   references, graph integrity, section provenance, history, and evidence
   against the files.
3. **Render.** Claude copies the cited lines into an excerpt file.
   `featurelens render` validates again, applies the write gate, checks
   each excerpt against its evidence hash, renders the HTML and writes it
   through a checked writer.
4. **Update.** When the code changes, `validate` reports which evidence
   **moved**, **changed**, went **missing** or became **ambiguous**, which
   claims cite it, and which sections show it. Claude revises those
   claims, `update` records the change in history, and `render`
   regenerates the page.

The [architecture document](docs/ARCHITECTURE.md) describes the pipeline
and its contracts in detail.

## Installation

Requirements:

- [Claude Code](https://claude.com/claude-code)
- Node.js 20 or newer
- git (optional; used for repository, revision and contributor metadata)

No `npm install` is needed. FeatureLens has no runtime dependencies.

### From GitHub

The repository is its own plugin marketplace
([`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)).
In Claude Code:

```
/plugin marketplace add <owner>/<repo>
/plugin install featurelens@featurelens
```

`<owner>/<repo>` is the GitHub repository FeatureLens is published at.
The same works from a shell with `claude plugin marketplace add
<owner>/<repo>` and `claude plugin install featurelens@featurelens`.

### From a local clone

```sh
git clone <repository-url> feature-lens
claude plugin marketplace add ./feature-lens
claude plugin install featurelens@featurelens
```

To try it for a single session without installing:

```sh
claude --plugin-dir path/to/feature-lens
```

## First use

Open Claude Code at the root of the repository you want to document and
ask, for example:

- "Document the payment flow with FeatureLens."
- "Use FeatureLens to show the impact of adding refunds to checkout."

or run `/featurelens:featurelens`. Claude confirms the feature and mode
with you, reads the code, runs `build` and `render`, and reports where the
page was written, usually `docs/features/<feature-id>/index.html`, along
with any evidence shown without an excerpt and the unknowns it recorded.

Later:

- "The payment code changed; update the payment-flow FeatureLens document."
- "Render the payment-flow document again with the interactive impact graph."

The skill ([skills/featurelens/SKILL.md](skills/featurelens/SKILL.md))
tells Claude exactly which commands to run. Claude does not need to write
any scripts.

## Workflows

Claude runs these commands for you. They are shown here so you can follow
what happens, review it, or run them yourself. They run from the root of
the documented repository, with `featurelens` standing for
`node path/to/feature-lens/bin/featurelens.js`. Claude keeps its working
files (`draft.json`, the working `manifest.json`, `excerpts.json`) in a
scratch directory outside the repository; only `render` writes into the
output folder.

### Build a new document

**draft → build → render**

```sh
# 1. Claude writes scratch/draft.json: feature, evidence locations (no hashes),
#    analysis, visualizations, sections and summary (docs/MANIFEST.md).
# 2. Stamp the evidence, add git metadata, validate. Writes scratch/manifest.json.
featurelens build scratch/draft.json --repo . --out scratch/manifest.json

# 3. Claude copies the cited lines into scratch/excerpts.json ([] is valid).
# 4. Check everything again and write docs/features/<feature-id>/.
featurelens render scratch/manifest.json --repo . --excerpts scratch/excerpts.json
```

`build` refuses (exit 1, nothing written) when a cited file or line range
doesn't exist, listing every such entry; when the manifest is invalid,
listing each error with its code and JSON Pointer; and when the feature
already has a document, which should be updated instead.

### Update a document after the code changed

**copy the existing manifest → validate → revise → update → render**

```sh
cp docs/features/payment-flow/manifest.json scratch/manifest.json

# What changed: each stale entry, the claims citing it, the sections showing it.
featurelens validate scratch/manifest.json --repo .

# Claude revises scratch/manifest.json: relocates moved evidence; for changed
# or missing evidence, re-reads the code, revises the claims and removes the
# entry's snippetHash so it is re-stamped; leaves history and manual sections
# alone. Then:
featurelens update scratch/manifest.json --repo . --out scratch/manifest.json \
  --summary "Relocated the gateway evidence after the refactor." \
  --changed-file src/payment/gateway.client.js

featurelens render scratch/manifest.json --repo . --excerpts scratch/excerpts.json
```

`update` compares the working copy with the existing `manifest.json` in the
output folder and prints what it touched, and why:

```
evidence ev-gateway: moved; updated
section  architecture: shows evidence ev-gateway (moved; updated)
section  risks: risks analysis data changed
review   manual section team-notes was not changed: cites evidence ev-manual (moved; not updated yet)
✓ recorded h-3 in scratch/manifest.json: 7 changed section(s). Next: collect excerpts, then render scratch/manifest.json
```

It appends one history entry (the git user, the current revision chained
to the previous one, the `--changed-file` list and the changed sections)
and writes only `--out`. It refuses, writing nothing, when:

- stale evidence is left unresolved (exit 3); the `refused [write-gate]`
  lines say which entry needs `relocate`, `reanalyze` or `review`
- the working copy changes the history or the feature id (exit 1)
- a manual section was changed, added or removed (exit 1), unless the
  user asked for it and it is named with `--edit-manual <section-id>`
- evidence lines don't exist, or the result is invalid (exit 1)

Manual sections that the change affects but that were not changed are
listed as `review` for the user. To review an update before it is
published, diff the working copy against the existing
`docs/features/<feature-id>/manifest.json`.

### Render again, and interactive rendering

```sh
featurelens render docs/features/payment-flow/manifest.json --repo . \
  --excerpts scratch/excerpts.json --interactive
featurelens render docs/features/payment-flow/manifest.json --repo . \
  --excerpts scratch/excerpts.json --mode product
```

Rendering a document's own `manifest.json` regenerates the page without
changing the document. `--interactive` adds keyboard-accessible node
selection to the impact diagram. `--mode` picks the
[presentation](#developer-and-product-modes). Neither is stored in the
manifest, so pass them on every render that should have them. Without
`--interactive`, the page has no script.

## Command reference

```sh
featurelens build <draft.json> --repo <dir> --out <file> [--json]
featurelens validate <manifest.json> [--repo <dir>] [--json]
featurelens update <manifest.json> --repo <dir> --summary <text> --out <file> \
    [--changed-file <path> ...] [--edit-manual <section-id> ...] [--acknowledge <evidence-id> ...] [--json]
featurelens render <manifest.json> --repo <dir> --excerpts <file> \
    [--acknowledge <evidence-id> ...] [--mode developer|product] [--interactive] [--json]
featurelens git-info [--repo <dir>] [--files <path> ...]
featurelens --help | --version
```

Every command takes `--json` for machine-readable output (except
`git-info`, which always prints JSON).

| Exit | Meaning |
|---|---|
| `0` | Success. For `validate`: valid, and all cited code is current. |
| `1` | Refused or invalid. Each problem is printed with a stable code and a JSON Pointer. Nothing is written. |
| `2` | Usage error. |
| `3` | Valid but **stale**: cited code has moved, changed or been deleted. `update` and `render` refuse, unless every stale entry is cited only by manual sections and acknowledged with `--acknowledge`. |

`validate` output looks like this:

```
error   [section.unknown] /analysis/findings/1/section: unknown section id "internals"
stale   [moved → relocate] /evidence/4 ev-pay-order: src/payment/payment.service.js:8-30 moved to lines 9-31; cited by /analysis/findings/0, …; sections: overview, architecture, implementation, impact, references
stale   [changed → reanalyze] /evidence/12 ev-gateway-result: src/payment/gateway.client.js:12-12 no longer matches the cited code; cited by …
```

All validation codes are listed in
[docs/MANIFEST.md](docs/MANIFEST.md#validation-codes). Try `validate` on
the bundled example with `npm run validate:example`.

### What `render` checks

`render` runs these steps in order and stops at the first refusal. Nothing
is written unless all of them pass:

1. Load the manifest and validate it against `--repo` (the same checks as
   `validate --repo`).
2. Apply the write gate: the manifest is valid, its evidence was checked,
   and no stale evidence is left. The only exception is evidence cited only
   by manual sections, and only when it is listed with `--acknowledge`.
3. Load `--excerpts` and check every excerpt against the manifest.
4. Render the HTML, then write it through the checked writer: existing
   output is checked, `index.html` is written, stamped and verified, and
   `manifest.json` is written last.

The excerpt file is a JSON array. Claude collects the excerpts with its own
tools; `render` never reads source files to fill them in:

```json
[{ "evidenceId": "ev-order-guards", "file": "src/payment/payment.service.js",
   "startLine": 9, "endLine": 11, "text": "<lines 9-11, joined with \\n>" }]
```

Each excerpt must match its evidence entry's location, and `text` must hash
to its `snippetHash`. Unknown ids, duplicates and excerpts for stale
evidence are refused. Evidence without an excerpt is shown as "no excerpt".

## Recovering from a refusal

FeatureLens refuses rather than guesses. There is no `--force`.

| Refusal | What to do |
|---|---|
| `build`: evidence location doesn't exist | Correct the file or lines in the draft; build again. |
| `build`/`update`/`render`: validation errors | Fix each error by its code and JSON Pointer ([docs/MANIFEST.md](docs/MANIFEST.md#validation-codes)). |
| `build`: the feature already has a document | Update it, or use another feature id. |
| Stale evidence (exit 3) | Resolve each entry as its action says; see [Stale evidence](docs/MANIFEST.md#stale-evidence). |
| `update`: history, feature id or a manual section changed | Restore it from the existing `manifest.json`; for a manual edit the user asked for, pass `--edit-manual`. |
| `update`: the working copy already records an update | Render it, or start again from a copy of the existing `manifest.json`. |
| `render`: `history-regression` | Start again from the existing `manifest.json` and use `update`. |
| `render`: `manual-section-changed` | Restore the manual section, or record the change with `update --edit-manual`. |
| `render`: hand-edited or foreign output folder | Render under a new feature id, or move the folder aside yourself. |

## Configuration

Optional `.featurelens.json` at the root of the documented repository:

```json
{
  "outputDir": "docs/features",
  "attribution": {
    "includeEmail": false,
    "includeContributors": true,
    "maxContributors": 20
  }
}
```

`outputDir` must be a relative path inside the repository. Emails are never
recorded unless `includeEmail` is `true`. A git `user.name` is recorded as
a name with `source: "git-config"`, never as a GitHub username.

## Safety and security

- **Evidence is checked, not trusted.** Every cited location must exist
  and match its SHA-256 hash. Stale evidence blocks `update` and `render`.
- **Writes are confined.** Only `render` writes into the output folder,
  which must be inside the repository. Paths are resolved through
  symlinks, and a symlink that leads outside the repository is refused.
  `build` and `update` write only the working manifest you name, never
  inside the output folder.
- **Existing output is protected.** `render` replaces only intact
  FeatureLens output. A hand-edited page (detected by a hash marker), a
  folder for another feature, a manifest that rewrites or drops history
  (`history-regression`), or one that changes a manual section without
  recording it (`manual-section-changed`) is refused.
- **Manual sections are protected** by both `update` and the writer.
- **Pages are locked down.** A Content-Security-Policy with `default-src
  'none'` blocks loading anything. Static pages, in either mode, have no
  script (navigation is CSS only);
  interactive pages allow exactly one constant inline script by its
  SHA-256 hash, with no `'unsafe-inline'` or `'unsafe-eval'` for scripts.
  All text is escaped.
- **No network, no shell.** The CLI makes no network requests. git runs
  without a shell. Credentials in remote URLs (`user:token@`) are stripped
  before they are recorded.

See [SECURITY.md](SECURITY.md) for details and how to report a
vulnerability.

## Known limitations

- **Large impact graphs.** Diagram edges are straight lines. In large or
  wide impact graphs, edges can pass through or behind nodes, and edges
  that skip layers can be hidden entirely (measured in
  [docs/EVALUATION.md](docs/EVALUATION.md), F-4). The text version under
  each diagram, and a selected node's details in `--interactive` pages,
  always list every relationship and are the authoritative fallback.
- **Re-stamping is trust-based.** Changed evidence is re-stamped when
  Claude removes its `snippetHash`, which the skill ties to re-reading the
  code and revising the claims. FeatureLens can't check that the claims
  were actually revised.
- **Changed files come from Claude.** `update` records `--changed-file` as
  given (from `git diff --name-only`); it doesn't list changed files
  itself.
- **The skill has not yet been evaluated with real prompts** on external
  repositories. The CLI and renderer have been evaluated end to end
  against Express and generated repositories
  ([docs/EVALUATION.md](docs/EVALUATION.md)).
- Wide layers make wide diagrams (224px per node). They scroll inside
  their own container; there is no pan or zoom.
- No size limit is enforced. Tested up to 1,000 components, 2,850
  relationships and 1,000 evidence entries: a 5.3 MB page, rendered in
  0.3 s and loaded by Chrome in about 1 s.
- Interactive pages need a browser that honors CSP script hashes; they
  are tested in Chrome only. Where script is blocked, the page is the
  complete static document.
- Evidence is checked by content hash, not by revision: cited code that is
  identical in another revision stays current.
- **Navigation without script has limits.** There is no search, Escape
  doesn't close the mobile drawer (use **Close menu** or follow a link),
  the sidebar highlights the current page but not the section scrolled
  to, and screen readers aren't told which sidebar link is current. The
  browser's find-in-page searches only the page shown; print, or use a
  browser without `:has()`, to get every page at once.
- **Product mode is a presentation, not a translation.** It words the
  interface and collapses detail; claim text stays as the analysis wrote
  it, in its language.

## Development

```sh
npm test                 # unit and CLI tests; browser tests skip without Chrome
npm run test:browser     # browser tests only; fails if no Chrome is found
npm run validate:example # the bundled example against its files
npm run eval             # end-to-end evaluation matrix (docs/EVALUATION.md)
npm run check:release    # all tests with Chrome required, the example, the matrix with a browser review
claude plugin validate . # plugin and marketplace metadata
```

Tests use the built-in `node:test` runner. The interactive impact graph and
the page layout (sidebar, hash navigation, mobile drawer, keyboard, both
modes at 390-1440px) are also tested in headless Chrome over the DevTools protocol, with no extra
dependencies. Without Chrome or Chromium, those tests are reported as
**skipped**, never as passed; set `FEATURELENS_REQUIRE_BROWSER=1` (as
`test:browser` and `check:release` do) to make a missing browser a
failure, and `CHROME_PATH` to choose one. Git tests create temporary
repositories and ignore your global git config.

### Library

The CLI is a thin layer over plain functions, which can also be imported
directly:

```js
import { SourceTree, createSourceRef } from './src/evidence/source.js';
import { createManifest, recordUpdate } from './src/manifest/build.js';
import { buildFromDraft, planUpdate } from './src/manifest/workflow.js'; // what build and update run
import { validateManifest } from './src/validation/validate.js';
import { buildImpactGraph } from './src/analysis/impact-graph.js';
```

### Project layout

```
.claude-plugin/      Plugin and marketplace metadata
skills/featurelens/  The skill: Claude Code's workflow for building and updating documents
bin/                 CLI (the only place modules are wired together)
schema/              Public manifest JSON Schema
src/validation/      validateManifest and its layers; checkWriteGate
src/evidence/        Reading cited source lines; createSourceRef
src/manifest/        createManifest, recordUpdate; buildFromDraft, planUpdate; JSDoc types
src/analysis/        Impact graph and diagram models
src/render/          Pure HTML renderer: layout and pages, overview, modes, stylesheet, excerpt contract, escaping, diagrams, the impact graph script
src/git/             Repository, user and contributor metadata
src/docs/, src/output/  Loading/serializing manifests; the checked writer
src/config/          .featurelens.json
test/                Tests and fixtures
examples/            Sample repository + manifest (also a test fixture)
eval/                Evaluation matrix: fixtures, the Express case, runner
docs/                Architecture, manifest reference, evaluation, roadmap
```

### Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): pipeline, modules, dependency rules, decisions
- [docs/MANIFEST.md](docs/MANIFEST.md): manifest reference, evidence model, validation codes
- [docs/EVALUATION.md](docs/EVALUATION.md): evaluation matrix, measurements, findings
- [docs/ROADMAP.md](docs/ROADMAP.md): what is done and what may come next
- [CHANGELOG.md](CHANGELOG.md): release notes

## Project status

FeatureLens 1.0.0 is the first public release. The manifest schema is
1.0.0 and follows semantic versioning
([docs/MANIFEST.md](docs/MANIFEST.md#versioning)). Ideas for later work are
in [docs/ROADMAP.md](docs/ROADMAP.md); they are not commitments.

## Contributing

Bug reports, fixes and documentation improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first, and please follow the
[Code of Conduct](CODE_OF_CONDUCT.md). For help, open a GitHub issue; see
[SUPPORT.md](SUPPORT.md).

## License

[MIT](LICENSE)
