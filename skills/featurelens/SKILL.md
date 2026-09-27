---
name: featurelens
description: Document one feature of the current repository (for example "the payment flow", or the impact of a proposed change) as an evidence-based HTML page where every claim cites real source lines, or update such a document after the code changed. Use when the user asks to document, explain or map a feature, or to assess the impact of a change, and wants a shareable document rather than a chat answer.
---

# FeatureLens

FeatureLens turns your analysis of one feature into `<outputDir>/<feature-id>/index.html`
plus its source of truth, `<outputDir>/<feature-id>/manifest.json` (`outputDir`
defaults to `docs/features`; a `.featurelens.json` at the repository root can
change it).

**Who does what.** You do all repository inspection with your own tools:
Glob, Grep and Read for code, Bash for `git log`, `git diff` and `git blame`.
You decide what the feature is, which files matter, what the code does and
what a change would impact. FeatureLens does not inspect the repository: it
has no analysis engine, no server and no network access. Its CLI only
validates the manifest you produce against the files it cites, checks the
source excerpts you hand over, and renders and writes the document safely.

The CLI and library are bundled with this plugin. Run every command from
the repository root, pass `--repo .`, and write the command out in full each
time, exactly as shown:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js" validate <scratch>/manifest.json --repo . --json
```

Claude Code fills in the plugin's install directory in these commands when
it loads this skill, so they are ready to copy. Each Bash call starts a
fresh shell: don't store the path in a shell variable and reuse it in a
later call. You never need to write a script: `build`, `update` and
`render` do the stamping, history and writing.

Fallback: if the path in the command above is not an absolute path to an
existing `bin/featurelens.js` (for example because the skill was loaded
from a copy outside the plugin), use the base directory shown when this
skill was loaded. The plugin root is two directories above it (the skill
lives in `skills/featurelens/`), so the CLI is
`<base directory>/../../bin/featurelens.js`. Put that absolute path
literally into each command.

Keep working files (`draft.json`, the working `manifest.json`,
`excerpts.json`) in a scratch directory outside the repository, never in
the output folder: only `render` writes `index.html` and `manifest.json`
there, and `build` and `update` refuse an `--out` inside it.

## Creating a document

1. **Scope.** Confirm with the user which feature, and the mode:
   `existing-feature` (document what exists) or `change-impact` (what a
   proposed change touches). Pick a feature id: lowercase letters, digits,
   `.`, `_`, `-`.
   **Then check for an existing document:** read `outputDir` from
   `.featurelens.json` at the repository root (default `docs/features`) and
   look for `<outputDir>/<feature-id>/manifest.json`. If it exists, stop
   here and follow "Updating a document" instead: it keeps the existing
   history. `build` refuses a feature id that already has a document, and
   `render` refuses a fresh manifest over it as `history-regression`.
2. **Inspect** the code with your own tools. Find the entry points,
   components, relationships, data flow, tests and risks. Where you can't
   establish something, record it in `analysis.unknowns` instead of guessing.
3. **Write the draft** to `<scratch>/draft.json`: the parts of the manifest
   you author, in the format of `${CLAUDE_PLUGIN_ROOT}/docs/MANIFEST.md`.

   ```json
   {
     "feature": { "id": "payment-flow", "name": "Order payment flow", "description": "…", "mode": "existing-feature", "request": "…" },
     "evidence": [
       { "id": "ev-pay-order", "file": "src/payment/payment.service.js", "startLine": 8, "endLine": 30,
         "symbol": "payOrder", "kind": "definition", "explanation": "The payment flow.", "confidence": "high" }
     ],
     "analysis": { "scope": { "…": "…" }, "files": [], "components": [], "relationships": [], "findings": [],
                   "impact": { "summary": "…", "items": [], "relationships": [] }, "risks": [], "testing": [], "unknowns": [] },
     "visualizations": {},
     "sections": [{ "id": "overview", "title": "Overview", "kind": "overview", "origin": "generated" }],
     "summary": "Initial analysis of the order payment flow."
   }
   ```

   - Evidence entries are locations only: never write a `snippetHash`.
   - Sections have no `provenance`. Add a `manual` section only with text
     the user gave you.
   - No `metadata`, `history`, repository or people: `build` adds them
     from git (`user.name` becomes a name with `source: "git-config"`,
     never a GitHub login; emails only if `.featurelens.json` allows them).
4. **Build:**
   `node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js" build <scratch>/draft.json --repo . --out <scratch>/manifest.json`.
   It stamps every evidence location (refusing lines that don't exist, one
   `error` line per entry), validates the manifest and writes it to
   `--out`. On exit 1, fix each `error` (issue `code` and JSON Pointer: a
   `/documentation/sections/…` path is the draft's `sections`, a
   `/metadata/feature/…` path its `feature`) and run it again.
5. **Collect excerpts** (see below) into `<scratch>/excerpts.json`.
6. **Render:**
   `node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js" render <scratch>/manifest.json --repo . --excerpts <scratch>/excerpts.json`
   (add `--json` for a machine-readable report; add `--mode product` when
   the audience calls for it, see "Presentation mode"; add `--interactive`
   only when the user asks for an interactive impact graph, see "Diagrams").
7. **Report** the path of `index.html` and the mode you rendered. Mention
   any evidence shown without an excerpt, and the unknowns you recorded.

## Presentation mode

`render --mode developer` (the default) or `render --mode product`. Both
render the same manifest with the same claims, certainty, evidence and
diagrams; the mode changes only labels and what starts collapsed. It is
not stored, so pass it on every render, and it changes nothing you write
in the manifest.

- **`developer`** (default): for engineers who will find, change, debug or
  review the code. Every claim shows its certainty and its sources
  (`file:lines` and symbol); the overview has a "Where it lives" card
  (entry points, primary files, configuration); code excerpts are open.
- **`product`**: for product engineers, architects and technical
  stakeholders who need to understand behavior rather than code: "how does
  this work, what can go wrong, what is still unknown". Certainty is
  worded plainly ("Read in code", "Inferred from code"), sources and
  implementation details sit under "Technical details", and the overview
  shows the first execution flow (else the first sequence) as numbered
  "How it works" steps.

Pick `product` only when the user asks for it or clearly describes a
non-implementation audience ("for the PM", "for a design review", "explain
it to stakeholders"); otherwise use the default. If unsure, ask. Product
mode does not rewrite your text, so when it is the target, write finding
titles and bodies, and step labels of the first execution flow, so they
read well to that audience. Keep them factual and backed by the cited
lines: never add business meaning the code doesn't show. To offer both,
render one, then the other; each render replaces the page.

## The generated page

The page is a small documentation app with no script: an overview page
(feature, repository, evidence status, key facts, the first section if it
is an `overview`, and links to findings, top risks, open questions and
diagrams), a sidebar that groups sections by kind (overview/scope;
architecture/implementation/impact; flows; risks/testing/unknowns;
custom; references/history), and one page per section, chosen by the URL
hash. On narrow screens the sidebar is a drawer behind a Menu button.
Groups with no section are not shown, so you don't need empty sections;
the order of `sections` is still the document order, and a finding
appears in the section it names. Give sections short titles: they are the
sidebar labels.

## Source excerpts

`render` never reads source files to show code. You hand it the cited lines
as a JSON array with one object per evidence entry, with exactly these keys:

```json
[
  {
    "evidenceId": "ev-order-guards",
    "file": "src/payment/payment.service.js",
    "startLine": 9,
    "endLine": 11,
    "text": "    const order = await this.orders.findById(orderId);\n    if (!order) return { ok: false, error: 'ORDER_NOT_FOUND' };\n    if (order.status !== 'pending') return { ok: false, error: 'ORDER_NOT_PAYABLE' };"
  }
]
```

- `evidenceId`, `file`, `startLine` and `endLine` must equal the manifest's
  evidence entry. The manifest stays authoritative: the excerpt file never
  changes it.
- `text` is lines `startLine..endLine` verbatim, joined with `\n`, with no
  trailing newline (CRLF becomes LF). Read them with the Read tool (or
  `sed -n 'START,ENDp' FILE`) and copy them exactly. Its SHA-256 must equal
  the entry's `snippetHash`, so a mistyped excerpt is refused by id; re-read
  the lines and try again.
- At most one excerpt per evidence id. Unknown ids, duplicates and wrong
  locations are refused. Order doesn't matter.
- Never supply an excerpt for stale evidence; it is refused.
- Evidence without an excerpt is rendered as "no excerpt", never as current
  code. `[]` is a valid file.

## Render results

To render an existing document again (for example with or without
`--interactive`, or in the other `--mode`), render its own manifest: collect excerpts for it and run
`render <outputDir>/<feature-id>/manifest.json --repo . --excerpts <scratch>/excerpts.json`.
Nothing about the document changes except the page.

`render` checks, in order: the manifest is valid; its evidence matches the
repository; the write gate; the excerpts; the existing output folder. It
writes nothing unless every check passes, and then writes `index.html`
first and `manifest.json` last.

| Exit | Meaning | What to do |
|---|---|---|
| `0` | Written; every evidence entry is current. | Report the path. |
| `1` | Refused: invalid manifest (fix by issue code), bad excerpt (re-collect it), unsafe existing output, or unreadable input. The last line (or `refused.step` in `--json`) says which. | Fix it and run `render` again. |
| `2` | Usage error (including a `--mode` other than `developer` or `product`). | Fix the command. |
| `3` | Stale evidence. Refused unless every stale entry is manual-only and acknowledged; then it is written with that evidence marked unverified (`written: true` in `--json`, a line starting `! wrote`). | See the next section. |

## Stale evidence

Each `stale` entry says what happened to the cited lines, what fixing it
takes, the `claims` that cite it, and the `sections` (generated and
manual) that show it:

- `moved` / `relocate`: the same lines are now at `movedTo`. Update the
  entry's `startLine` and `endLine` (the hash stays the same).
- `changed` or `missing` / `reanalyze`: re-read the code, revise the claims
  listed in `claims`, set the entry's `file`, `startLine` and `endLine` to
  what now supports them, and **remove its `snippetHash`**: `update`
  re-stamps entries without one from the current lines. Removing the hash
  without re-reading the code and revising the claims would certify claims
  you haven't checked; never do that. A renamed file is `missing`: find
  where the code went with git, and change the path in `analysis.files`
  too. If nothing supports a claim any more, remove the claim or turn it
  into an `unknowns` entry; don't keep it.
- `ambiguous` / `review`: several places match (`candidates`). Pick one
  with the user.
- `manualOnly` / `review`: only manual sections cite it. FeatureLens never
  rewrites manual sections. Ask the user to either edit the section, or
  explicitly accept the evidence as is. Only with that acceptance, pass
  `--acknowledge <evidence-id>` to `update` and `render`. It then renders
  as unverified, and exit code 3 remains until the section is fixed.
  `--acknowledge` has no effect on evidence that any generated claim
  cites.

## Updating a document after the code changed

Use this whenever `<outputDir>/<feature-id>/manifest.json` exists, whether
the user asked for an update or to "document" a feature that already has a
document. The update appends to the existing history; it never starts a new
one.

1. **Copy the existing manifest.** Copy
   `<outputDir>/<feature-id>/manifest.json` to `<scratch>/manifest.json`,
   your working copy. Never read `index.html` back: it is derived output.
   `update` reads the original from the output folder itself.
2. **See what changed:**
   `node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js" validate <scratch>/manifest.json --repo . --json`.
   Exit 3 lists each `stale` entry with its `status`, `action`, `claims`
   and `sections`; exit 0 means every cited location is current. If it is
   invalid (exit 1), report the errors to the user and stop: don't paper
   over them with a new document. Also use `git log` / `git diff` from
   the manifest's `metadata.repository.revision` to find new code the
   document should cover.
3. **Revise the working copy.** Resolve every stale entry as in "Stale
   evidence", and edit evidence, claims and generated sections as the
   code now requires. New evidence entries go in without `snippetHash`,
   new sections without `provenance`. Leave `history`,
   `metadata.feature.id` and every `origin: "manual"` section exactly as
   they are, unless the user asked you to change a manual section.
4. **Record the update:**
   `node "${CLAUDE_PLUGIN_ROOT}/bin/featurelens.js" update <scratch>/manifest.json --repo . --summary "<one sentence: what this update changed>" --out <scratch>/manifest.json --changed-file <path> …`
   - `--changed-file`: each source file the document cites or should cover
     that changed since the last revision, from
     `git diff --name-only <revision> HEAD` (omit it when there is no
     revision to compare).
   - `--edit-manual <section-id>`: only when the user asked you to change,
     add or remove that manual section.
   - `--acknowledge <evidence-id>`: only as described in "Stale evidence".

   `update` compares the working copy with the existing `manifest.json`,
   stamps entries without `snippetHash`, works out which sections changed
   and why, appends the history entry (who, from git; the current git
   revision, chained to the previous one; branch and dirty refreshed),
   validates it and applies the write gate. It writes only `--out`, and
   only when everything passed. Its report lists the touched `evidence`,
   each changed section with its `reasons`, `removedSections`, and
   `manualToReview`: manual sections the change affects but that were not
   changed. Tell the user about those.
5. **Collect fresh excerpts and render** as when creating.

| `update` exit | Meaning | What to do |
|---|---|---|
| `0` | Recorded in `--out`. | Collect excerpts and render it. |
| `1` | Refused: `refused.step` is `manifest`, `existing-document`, `evidence` (lines that don't exist), `validation`, `plan` (the working copy changed history, the feature id or a manual section: see `refused.problems`) or `output`. Nothing written. | Fix what it names and run it again. For `plan`, restore what you shouldn't have changed from the existing `manifest.json`. |
| `2` | Usage error (`--repo`, `--summary` and `--out` are required). | Fix the command. |
| `3` | Stale evidence is left: refused, nothing written. Or, with every remaining stale entry manual-only and acknowledged: written. | Resolve the entries in the `refused [write-gate]` lines, then run `update` again. |

Which sections `update` marks as changed: new sections, sections whose own
content you edited, sections holding a finding or listing a visualization
you changed, generated sections whose kind's analysis data changed (for
example `risks` when a risk changed), and every generated section that
shows touched evidence (stale, added, removed or edited). Manual sections
only with `--edit-manual`. The `history` section is never listed. It is
deterministic: the same two manifests always give the same list.

## Existing output that is refused

`render` refuses to replace an output folder that isn't intact FeatureLens
output. That includes a hand-edited or unmarked `index.html`, a folder for
another feature id, a schema version mismatch, or `index.html` without
`manifest.json`. The CLI has no option to override this.

`history-regression` is different: the output is intact, but the manifest
you rendered doesn't keep the existing `manifest.json`'s history entry for
entry (`existing.historyRegression.reason` in `--json` says whether it is
`older`, `replaced`, `removed`, `reordered` or `modified`). Don't ask the
user to move anything: start again from the existing `manifest.json` as in
"Updating a document", and record your changes with `update`.

`manual-section-changed` is similar: the manifest changes, adds back or
removes a manual section without a new history entry that records it
(`existing.manualSections` names them). Restore the section from the
existing `manifest.json`, or, if the user asked for the change, record it
with `update --edit-manual`.

For any other refusal, tell the user what was found (the `refused.code`)
and offer two choices: render under a new feature id, or have them move the
folder aside themselves. Never delete it without their explicit
confirmation.

If `index.html` was generated from a newer history entry than
`manifest.json` (an interrupted write), `render` regenerates it from the
manifest and prints a note. That is expected.

## Diagrams

The document draws a static impact diagram in generated `impact` sections
and every visualization a section lists: architecture views, execution
flows, sequences, state machines and data flows, each with a legend and a
text version. The diagrams show only what the manifest declares, so put
what you found into the visualization itself:

- Execution flow: give `start`, and a `condition` on every `next` of a
  step that branches. Step order in the list is not execution order; only
  `start` and `next` are. A `next` link is part of its step's claim, so
  cite evidence for the step that covers where it goes next.
- Sequence: list `messages` in the order they happen; they are drawn and
  numbered in that order. Use `kind` `return` for replies and `async` only
  where the code really doesn't wait.
- State machine: mark the initial state (exactly one) and any terminal
  states yourself; nothing is inferred, and nothing is shown as reachable.
- Data flow: use `store` only for something that holds data; it is the
  only kind described that way.
- Architecture view: `groups` are drawn as boxes around their nodes. Use
  them to organize the view (layers, modules); a box is not a claim and is
  not read as a runtime or deployment boundary, so say so in a section or
  finding, with evidence, if it is one. A node can be in one group only.

Inputs and outputs of steps, transition actions and timing have no field
and are not drawn. Put them in a section body or a finding if they matter.

`render --interactive` makes the impact diagram selectable: clicking a
node, or tabbing to it and pressing Enter, highlights its direct incoming
and outgoing relationships and shows its details (certainty, sources,
unverified evidence, derived items as not claims), taken from the text
version. The page then carries one inline script allowed by its hash in
the page's Content-Security-Policy; without the flag it has none. It
changes no claim, adds nothing to the manifest, and has to be passed on
every render. Other diagram types stay static. Use it only when the user
asks for interactivity.

## Not available yet

The page has no search. Without script, the mobile drawer doesn't close
on Escape, and the sidebar marks the current page but not the section
scrolled to. Product mode doesn't translate or summarize the analysis.

Only the impact diagram can be made interactive, and only by selecting a
node: there is no pan, zoom, filtering, search or transitive highlighting.
Architecture views reduce crossings with a heuristic but don't minimize
them, and route only edges that skip layers around nodes. The impact
diagram routes no edges: in large or wide impact diagrams many edges pass
behind other nodes and some are hidden, so for a feature with more than a
few dozen impacted components, point the user to the text version under
the diagram (and, with `--interactive`, to the selected node's details),
which always list every relationship. Don't promise more than that to the
user.
