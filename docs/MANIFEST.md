# Manifest reference (schema 1.0.0)

The manifest is the structured result of analyzing one feature in one
repository. The analysis step produces it, the validator checks it, and
renderers and updaters consume it. It is JSON, defined by
[`schema/featurelens-manifest.schema.json`](../schema/featurelens-manifest.schema.json)
and mirrored as JSDoc types in [`src/manifest/types.js`](../src/manifest/types.js).

A complete example that validates against its sample repository:
[`examples/sample-shop/featurelens/payment-flow.manifest.json`](../examples/sample-shop/featurelens/payment-flow.manifest.json).
The smallest valid manifest: [`test/fixtures/minimal.manifest.json`](../test/fixtures/minimal.manifest.json).

## Top level

| Field | Required | Contents |
|---|---|---|
| `schemaVersion` | yes | `"1.0.0"`. See [Versioning](#versioning). |
| `metadata` | yes | What was analyzed, where, when, and by whom. |
| `evidence` | yes | Source references. Every claim cites these by id. |
| `analysis` | yes | Scope, files, dependency graph, findings, impact, risks, testing, unknowns. |
| `visualizations` | yes, may be `{}` | Optional diagram data, one array per diagram type. |
| `documentation` | yes | Sections, in document order, with provenance. |
| `history` | yes, ≥ 1 entry | Append-only log: one creation, then updates. |

Ids everywhere match `^[a-z0-9][a-z0-9._-]{0,79}$`. Paths are POSIX,
relative to the repository root, without `.`/`..`/empty segments, backslashes
or drive letters. Timestamps are RFC 3339. Revisions are 7–64 hex characters.

## Claims, certainty and evidence

Most analysis items are **claims**: they carry `certainty` and `evidence`
(a list of evidence ids).

| `certainty` | Meaning | Evidence |
|---|---|---|
| `observed` | Read directly in the cited lines | required |
| `inferred` | A reasonable conclusion from the cited lines, not stated literally | required |
| `proposed` | Recommended implementation impact; not in the code | optional |
| `unknown` | Could not be determined | optional |

What could not be verified goes in `analysis.unknowns`, never into a guess.

### Source references (`evidence[]`)

| Field | Required | Notes |
|---|---|---|
| `id` | yes | |
| `file` | yes | Repository-relative path. Must exist when validated with `--repo`. |
| `startLine`, `endLine` | yes | 1-based, inclusive. Must lie within the file. |
| `kind` | yes | `definition`, `call-site`, `logic`, `usage`, `configuration`, `data-schema`, `test`, `documentation`, `comment`, `other` |
| `explanation` | yes | Why these lines support the claims that cite them. |
| `confidence` | yes | `high`: the lines state it outright. `medium`: they support it with some reading between the lines. `low`: suggestive only. |
| `symbol` | no | Name expected within the range. A mismatch is a warning, since line numbers may drift. |
| `revision` | no | Revision the lines were read at, if different from `metadata.repository.revision`. |
| `snippetHash` | yes | `sha256:<hex>` of lines `startLine..endLine` joined with `\n`, with CRLF normalized to LF. Stamped by `createSourceRef` from the real lines. Validation with `--repo` uses it to tell current evidence from [stale](#stale-evidence) evidence. |

`certainty` describes a *claim*. `confidence` describes how strongly one
*piece of evidence* supports the claims that cite it.

Create references with `createSourceRef(tree, input)` from
`src/evidence/source.js`. It reads the real lines, refuses locations that do
not exist and fills in `snippetHash`, so a fabricated location cannot produce
a valid reference. A reference without a hash has not been checked, and is
rejected (`schema.required`).

## `metadata`

- `feature`: `id` (becomes the output folder), `name`, `description`,
  `mode` (`existing-feature` or `change-impact`), the verbatim `request`, and
  `proposedChange` (required for `change-impact`).
- `repository`: `name`, and when available `remoteUrl` (credentials
  stripped), `branch`, `revision`, `dirty`. `dirty` is true when the working
  tree has tracked changes (including deletions) or untracked files that are
  not ignored, since the analysis may cite files that `revision` doesn't contain.
- `tool`: `{ name: "featurelens", version }`.
- `generatedAt` / `updatedAt`: must equal the first and last history
  timestamps.
- `generatedBy` and `contributors[]`: people, each with a `source` saying
  where the identity came from (see [Attribution](#attribution)).

## `analysis`

| Field | Contents |
|---|---|
| `scope` | `summary`, `inScope[]`, `outOfScope[]`, optional `entryPoints[]` (component ids). |
| `files[]` | Relevant files: `path`, `role` (`primary`, `supporting`, `test`, `config`, `schema`, `documentation`), `reason`, optional `evidence`. |
| `components[]` | Graph nodes (claims). `kind`: `module`, `service`, `function`, `class`, `endpoint`, `model`, `datastore`, `external`, `ui`, `job`, `config`, `test`, `other`. Optional `parent` (containing component; no cycles). `endpoint: { protocol, method?, path }` only on endpoints. `dependency: { name, ecosystem?, version? }` only on externals. |
| `relationships[]` | Graph edges (claims): `from`, `to`, `kind` (`calls`, `imports`, `reads`, `writes`, `emits`, `subscribes`, `renders`, `configures`, `depends-on`, `contains`), optional `label`. |
| `findings[]` | Prose claims, each in one documentation `section`. `body` is plain text, never HTML. |
| `impact` | `summary`; `items[]` (claims naming a `componentId`, a `file` or both, with `level` high/medium/low and `change`: `add`, `modify`, `remove`, `review` or `none`); `relationships[]` (claims: a change to item `from` forces or risks a change to item `to`). |
| `risks[]`, `testing[]` | Notes (claims): `title`, `body`, optional `severity`. |
| `unknowns[]` | `kind`: `question` (behavior that could not be verified) or `limitation` (what the analysis did not cover), `statement`, `reason`, optional `evidence`. |

`buildImpactGraph(manifest)` (in `src/analysis/impact-graph.js`) turns
components, relationships and impact into one graph for renderers. It also
marks components that transitively depend on something directly impacted.

The rendered **impact diagram** (in generated `impact` sections) is built
from exactly this data, with no extra fields: impact items are the
*direct* nodes (with their certainty and evidence), impact relationships
are the *declared* edges, and components that depend on something impacted
are *derived* nodes and edges, drawn and labelled as not a claim and
without evidence. See ARCHITECTURE.md §6.1.1.

## `visualizations`

Every type is optional; include only what fits the feature. Visualization
ids are unique across all types so sections can reference them.
Every type is drawn as a static diagram with a legend and a text version
wherever a section lists it: architecture views as in ARCHITECTURE.md
§6.1.1 and §6.1.3, the other four as in §6.1.2. Phase 3B needed no schema change. The
diagrams draw only what is declared here; FeatureLens infers no step, link,
message, state, transition, initial or terminal state, data transformation
or persistence, and computes no derived relationship for these types.

| Type | Shape | Rules |
|---|---|---|
| `architecture[]` | `groups[]?` (`id`, `label`), `nodes[]` (`componentId`, `group?`), `edges[]` (relationship ids) | A view over the analysis graph. Both ends of each edge must be nodes of the view. A node's `group` must be a group of the view; a node is in at most one group. Drawn as a static diagram with a box per group that has nodes (ARCHITECTURE.md §6.1.3). Groups organize the view: they are not claims, carry no evidence, and are not runtime, deployment or process boundaries unless a section or finding says so. Groups with no nodes are listed in the text version, not drawn. |
| `executionFlows[]` | `start`, `steps[]` (claims: `id`, `label`, `componentId?`, `next[]?` of `{ to, condition? }`) | `start` and every `next.to` must be steps. Steps not reachable from `start` are warned about. Drawn from `start`; a step with two or more `next` is a decision, one with none has no next step. A `next` link has no claim of its own: it shows its step's certainty and evidence. Step order in the list is not execution order. |
| `sequences[]` | `participants[]` (`id`, `label`, `componentId?`), `messages[]` in order (claims: `from`, `to`, `label`, `kind`: `call`, `return`, `async`, `event`) | Messages connect declared participants. Drawn and numbered in list order, never re-sorted; self-messages are loops on the lifeline. No timing is implied. |
| `stateMachines[]` | `subject?`, `states[]` (`id`, `label`, `initial?`, `terminal?`), `transitions[]` (claims: `from`, `to`, `trigger`, `guard?`) | Exactly one initial state. No transitions out of terminal states. Unreachable states are warned about. Initial and terminal states are shown only as declared; a transition identical to an earlier one is kept and marked as a repeat. |
| `dataFlows[]` | `nodes[]` (`id`, `label`, `kind`: `source`, `process`, `store`, `sink`, `external`, `componentId?`), `flows[]` (claims: `from`, `to`, `data`) | Flows connect declared nodes. Only `store` nodes are described as holding data; repeated `data` labels stay separate flows. |

Steps, messages, transitions and flows have no `id` in the schema; the
rendered diagrams name them by position (`next:<step>/<n>`, `message:<n>`,
`transition:<n>`, `flow:<n>`), so their order in the manifest is part of
what a diagram shows. States, participants and data-flow nodes are
declarations, not claims: they carry no certainty or evidence, and a
`componentId` names the component without borrowing its evidence.

## `documentation.sections[]`

| Field | Notes |
|---|---|
| `id` | Stable anchor. Findings and history refer to it. |
| `title` | |
| `kind` | Which analysis data the renderer lays out here: `overview`, `scope`, `architecture`, `implementation`, `flows`, `impact`, `risks`, `testing`, `unknowns`, `references`, `history`, or `custom` (body, findings and visualizations only). The mapping is in ARCHITECTURE.md §6.1. |
| `origin` | Manual content marker. `generated`: FeatureLens owns it and may regenerate it. `manual`: written by a person, never modified by updates, and must have a `body`. A manual section is rendered with its body, sources, findings and visualizations only, never with generated analysis data of its `kind`. |
| `body` | Optional plain-text introduction. |
| `sourceRefs[]` | Evidence ids cited by the section as a whole. |
| `visualizations[]` | Visualization ids shown in the section. |
| `provenance.historyId` | The history entry that last changed this section. That entry must list the section in `changedSections`. |

## `history[]`

| Field | Notes |
|---|---|
| `id` | Unique. `createManifest` and `recordUpdate` use `h-1`, `h-2`, … |
| `at` | Chronological across entries. |
| `action` | `created` for the first entry only, `updated` after. |
| `by` | Person who ran it. |
| `toolVersion`, `summary` | |
| `previousRevision` | Must equal the previous entry's `revision`. Not allowed on `created`. |
| `revision` | The last entry's revision must equal `metadata.repository.revision`. |
| `changedFiles[]` | Source files changed between the two revisions, as supplied by the caller (Claude gets them with its own git tools). |
| `changedSections[]` | Section ids this entry wrote. Ids of since-deleted sections are warned about, not rejected. |
| `validation` | `{ valid, errorCount, warningCount, evidenceChecked }` for the manifest as written by this entry. `valid` must equal `errorCount === 0`. It records validity, not freshness: stale evidence is not counted, because commands that write a manifest refuse stale evidence (`checkWriteGate`) on the same validation result. See ARCHITECTURE.md §5. |

The last entry's `id` is also the `historyId` in the generated
`index.html` marker, which is how the HTML is tied to the manifest it was
rendered from.

History is append-only across writes, too: when a feature's output folder
already has a `manifest.json`, the new manifest's `history` must start
with every existing entry, unchanged and in order. Otherwise the write is
refused as `history-regression` (ARCHITECTURE.md §7). Start updates from
the existing `manifest.json` and append with `featurelens update` (which
calls `recordUpdate`).

Manual sections are protected the same way: a write that changes (other
than `provenance`) or removes a manual section of the existing
`manifest.json` is refused as `manual-section-changed` unless one of the
new history entries lists that section in `changedSections`, which
`update` does only for sections named with `--edit-manual`.

## Output files

A manifest is written as `<outputDir>/<feature.id>/manifest.json`
(`serializeManifest` output), next to the `index.html` rendered from it.
`manifest.json` is the source of truth; the HTML is fully regenerated from
it and never read back. Both files are written only by
`writeFeatureDocument` in `src/output/writer.js`: `index.html` first, then
`manifest.json` last. Before writing, it checks the existing files and
refuses to replace output that isn't intact FeatureLens output (for
example, HTML edited by hand). The marker format, hash calculation and
refusal rules are in [ARCHITECTURE.md](ARCHITECTURE.md) §6–7.

`index.html` comes from `render(manifest, { excerpts, stale })`
(`src/render/render.js`, ARCHITECTURE.md §6.1). Every string in the
manifest is rendered as escaped text, never as HTML. Source code is not part
of the manifest: the caller supplies the cited lines for each evidence entry
as an excerpt `{ evidenceId, file, startLine, endLine, text }`, which must
match the entry's location and `snippetHash`. Stale evidence is shown as
unverified, without code.

### Excerpt file (`render --excerpts`)

`featurelens render` takes the excerpts as a JSON file: an array of
excerpt objects, each with exactly the keys `evidenceId`, `file`,
`startLine`, `endLine` (integers) and `text`. Claude Code writes it for one
render from the lines it read; FeatureLens never reads source files to fill
it in, and it is not stored anywhere.

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

It is not a second source of truth: every field must equal the evidence
entry's, and `text` must hash to its `snippetHash`, so the file can only
repeat what the manifest already says. `render` refuses a file that isn't
such an array, and any excerpt with an unknown id, a duplicate id, a
different location, the wrong number of lines, a hash mismatch, or stale
evidence. An evidence entry with no excerpt is rendered as "no excerpt".

## Attribution

Every person (`generatedBy`, `contributors[]`, `history[].by`) has a
`source`:

| `source` | Where the identity comes from |
|---|---|
| `git-config` | `git config user.name` (and `user.email`) of whoever ran FeatureLens. |
| `git-log` | A **commit author** from `git log --no-merges --format=%aN%x1f%aE -- <cited files>`. `%aN`/`%aE` apply `.mailmap` when the repository has one. Authors are grouped by email; committers are not recorded. |
| `github-api` | An authenticated GitHub lookup (not implemented yet). |
| `user-provided` | Stated explicitly by the user. |
| `unknown` | Could not be resolved. Nothing is guessed in its place. |

- A git name is a free-form display name. It is **never** a GitHub
  username: `githubLogin` is only set from `github-api` or `user-provided`,
  never derived from `user.name` or a commit author.
- `email` is included only when `.featurelens.json` sets
  `attribution.includeEmail: true`.
- The repository owner is not recorded or inferred from the remote URL.

## Stale evidence

With `--repo`, each evidence entry whose `snippetHash` no longer matches its
cited lines becomes a **stale entry**, reported in `stale` beside `errors`
and `warnings`. A stale manifest is still valid: it was correct when it was
stamped, and the code has moved on since.

| `status` | Condition | `action` |
|---|---|---|
| `moved` | Exactly one other window of the same number of lines in the file has the hash. `movedTo` gives its range. | `relocate` |
| `changed` | No window in the file has the hash (also when the file got shorter than the range). | `reanalyze` |
| `missing` | The file was deleted or is no longer a regular file. | `reanalyze` |
| `ambiguous` | Several windows have the hash. `candidates` lists them; nothing is moved. | `review` |

Each entry also has `evidenceId`, `path` (JSON Pointer of the evidence),
`file`, `message`, `claims` (JSON Pointers of every claim and section citing
the evidence), `manualSections` (manual sections whose `sourceRefs` list it)
and `manualOnly`. `manualOnly` is true when the only citations are manual
sections' `sourceRefs`; then `action` is `review`, whatever the status,
because FeatureLens never rewrites manual content. A finding placed in a
manual section is still a generated claim and does not count as manual use.

**Why `missing` is staleness, not an error.** From the manifest alone, a
file deleted after the document was written and a path that never existed
look the same, and nothing FeatureLens could add to the manifest would prove
the difference, since the manifest itself can be edited. Both mean the same
thing: *this evidence can't be verified now*, so both get `reanalyze`, exit
code 3, and a closed write gate. Invented locations are stopped where they
can be proven: `createSourceRef` refuses lines that don't exist, so every
hash in a manifest FeatureLens wrote came from real lines. A renamed file is
also `missing`; finding where the code went is Claude's job (with git), not
a repository-wide search in FeatureLens.

| Case | Result |
|---|---|
| File deleted since the evidence was stamped | stale `missing` |
| File renamed or moved | stale `missing` |
| Path that never existed | stale `missing` |
| Fabricated hash on a real file | stale `changed` (no window matches) |
| Absolute path, `..`, backslash, drive letter | `schema.pattern` error |
| Symlink resolving outside the repository | `evidence.file` error; never read |
| Dangling symlink | stale `missing`; nothing to read |
| Directory, FIFO, device | stale `missing`; never read |
| File exists but can't be read (permissions) | `evidence.file` error: it can't be verified either way |

**Cost of the `moved` search.** It runs only for evidence whose hash no
longer matches, and hashes every window of the cited length: about
(file lines × cited lines). Typical citations (under a few hundred lines, in
files under 20,000 lines) take well under a second; a 5,000-line citation in
a 20,000-line file takes seconds.

Validation never modifies the manifest. `checkWriteGate` (in
`src/validation/gate.js`) refuses to write while any stale entry remains,
except `manualOnly` ones acknowledged explicitly by evidence id.

A path that escapes the repository (for example through a symlink) is an
`evidence.file` **error**, never staleness.

## `featurelens validate` exit codes

| Code | Meaning |
|---|---|
| `0` | Valid, and (with `--repo`) every evidence entry is current. |
| `1` | Invalid: at least one error, or the file can't be read or parsed. Takes precedence over `3`. |
| `2` | Usage error. |
| `3` | Valid, but at least one evidence entry is stale. |

## `featurelens render` exit codes

| Code | Meaning | Written? |
|---|---|---|
| `0` | Valid, every evidence entry current, document written. | yes |
| `1` | Refused: the manifest can't be read or is invalid, the excerpt file or an excerpt is rejected, the existing output isn't safe to replace, the output path leaves the repository, or `.featurelens.json` is invalid. | no |
| `2` | Usage error (`--repo` and `--excerpts` are required). | no |
| `3` | Valid but stale. Refused while any stale entry blocks the write gate. Written when every stale entry is `manualOnly` and passed with `--acknowledge`; that evidence is shown as unverified. | see `written` in `--json` |

Code `3` keeps the meaning it has for `validate`, "valid but stale", so a
document with acknowledged stale evidence never reports `0`.

## `featurelens build` and `update` exit codes

Both write only their `--out` file (never inside the output directory),
and only on `0`, or on `3` with `written: true`.

| Code | `build` | `update` |
|---|---|---|
| `0` | Manifest built from the draft and written. | Update recorded and written. |
| `1` | Refused: unreadable draft or config, wrong draft shape, evidence locations that don't exist, an invalid manifest, a feature that already has a document, or an `--out` inside the output directory. | Refused: unreadable input, no (or an unusable) existing document, evidence locations that don't exist, an invalid manifest, a working copy that changes the history, the feature id or a manual section not named with `--edit-manual`, or an `--out` inside the output directory. `refused.step` names which. |
| `2` | Usage error (`--repo` and `--out` are required). | Usage error (`--repo`, `--summary` and `--out` are required). |
| `3` | — | Stale evidence is left: refused, or written when every stale entry is `manualOnly` and passed with `--acknowledge`. |

## Versioning

`schemaVersion` is semver. A minor bump only adds optional fields. A major
bump comes with a migration. A tool reads manifests with its own major
version and a minor no newer than its own. Anything else gets one
`version.unsupported` error, and validation stops.

1.0.0 is the first published version. The draft format used during v0.1
development (`document`, `flows[]`, `uncertainties[]`) was never released
and is not supported.

1.0.0 was corrected in place before any release, when no documents existed:
`evidence[].snippetHash` became required, and
`documentation.sections[].provenance.contentHash` was removed (the output
contract detects hand edits with a document-level marker instead; see
ARCHITECTURE.md §6). Nothing written with the earlier draft of 1.0.0 needs
migrating. From here on, changes follow the rules above.

## Validation codes

Errors make a manifest invalid. Warnings do not. Stale evidence is
reported separately, not as a code here: see [Stale evidence](#stale-evidence).

| Code | Severity | Meaning |
|---|---|---|
| `version.unsupported` | error | `schemaVersion` has an unsupported major, a newer minor, or is malformed. Nothing else is checked. |
| `schema.<keyword>` | error | JSON Schema failure, e.g. `schema.required`, `schema.enum`, `schema.pattern`, `schema.additionalProperties`. Semantic checks are skipped until these are fixed. |
| `id.duplicate` | error | Same id twice in a collection (or same path in `files`, same component in a view). |
| `ref.unknown` | error | A reference to an evidence, component, relationship, impact item, step, state, node, group, visualization or history id that does not exist. |
| `section.unknown` | error | A finding names a section id that does not exist. |
| `section.provenance` | error | A section's `historyId` entry does not list it in `changedSections`. |
| `section.manual-body` | error | A manual section has no `body`. |
| `section.manual-findings` | warning | Generated findings are placed in a manual section. |
| `evidence.required` | error | An `observed` or `inferred` claim cites no evidence. |
| `evidence.range` | error | `endLine` before `startLine`. (A range past the end of the file is [stale](#stale-evidence) `changed`.) |
| `evidence.file` | error | Cited file resolves outside the repository, or exists but can't be read. (A deleted file is stale `missing`.) |
| `evidence.symbol` | warning | `symbol` does not appear in the cited range (checked for current evidence only). |
| `evidence.uncited` | warning | Evidence nothing refers to. |
| `evidence.unlisted-file` | warning | Evidence file not listed in `analysis.files`. |
| `evidence.revision` | warning | Evidence read at a different revision than the analysis. |
| `file.missing` | error | A listed file, or an impact file whose change isn't `add`, does not exist (or escapes the repository), and no evidence cites it. When evidence cites it, the evidence's stale entry covers it instead. |
| `impact.missing-target` | error | Impact item names neither a component nor a file. |
| `impact.file-exists` | warning | Impact item says `add` but the file already exists. |
| `component.detail-mismatch` | error | `endpoint` on a non-endpoint, or `dependency` on a non-external. |
| `feature.proposed-change` | error | `change-impact` mode without `proposedChange`. |
| `graph.parent-cycle` | error | Component parent chain loops. |
| `graph.edge-outside-view` | error | Architecture edge whose endpoint is not a node of the view. |
| `graph.initial-state` | error | State machine without exactly one initial state. |
| `graph.terminal-outgoing` | error | Transition out of a terminal state. |
| `graph.self-loop` | warning | Relationship or impact relationship from a node to itself. |
| `graph.duplicate-edge` | warning | Two relationships with the same from, to and kind. |
| `graph.unreachable` | warning | Execution step or state not reachable from the start. |
| `history.action` | error | First entry is not `created`, or a later one is. |
| `history.order` | error | Entries out of chronological order. |
| `history.timestamps` | error | `generatedAt`/`updatedAt` disagree with the first/last entry. |
| `history.revision-chain` | error | `previousRevision` doesn't match the prior entry, is set on `created`, or the last revision differs from the repository's. |
| `history.validation` | error | `valid` disagrees with `errorCount`. |
| `history.unknown-section` | warning | `changedSections` names a section that no longer exists. |
