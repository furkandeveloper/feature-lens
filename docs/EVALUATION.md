# Evaluation (Phase 3E)

What FeatureLens was run against end to end, what held, what didn't, and
the measured limits. Everything below can be reproduced with
[`eval/run.js`](../eval/run.js); numbers are from one run on an Apple
Silicon Mac, Node 24.14, Chrome (current stable), 2026-09-24.

```sh
npm run eval                                   # deterministic local matrix (no network, no Chrome)
node eval/run.js --scale --browser --out /tmp/fl-eval   # + large graphs, Chrome review, keep outputs and screenshots
node eval/run.js --express <express checkout>  # + the Express case (clone of expressjs/express)
npm run check:release                          # tests with Chrome required + example + matrix with browser review
```

`eval/run.js` drives the real CLI (`validate`, `render`, `render
--interactive`) through the writer, checks the outcome of every step
(exit code, refusal step and code, written files, bytes), measures
in-process validation, diagram model and render times, and with
`--browser` loads every written page in headless Chrome at 390px and
1280px, light and dark. It exits 1 when an expectation fails and 4 when
`--browser` was asked for but no Chrome was found.

## Evaluation repositories

| # | Repository | Revision | Why it is representative |
|---|---|---|---|
| 1 | `examples/sample-shop` (in this repo) | working tree | Small, simple architecture; every section kind and diagram type |
| 2 | [expressjs/express](https://github.com/expressjs/express), MIT | `4.21.2` = `1faf2289`, also checked at `4.19.2` and `v5.0.0` | Real medium repository (11 files, 4,140 lines in `lib/`), multiple modules, dependency relationships, 6 architecture groups, all five diagram types; real code motion between tags |
| 3 | `eval/fixtures.js` `manyGroups` | generated | 12 groups of 1–6 nodes, an empty group, ungrouped nodes, a 76-character group label |
| 4 | `eval/fixtures.js` `layeredGraph` | generated | Large impact graphs: 6×10, 10×40, 20×50 layered services; hubs with 120 and 500 dependents |
| 5 | copies of the sample, mutated | generated | Moved, changed, missing, renamed, ambiguous and manual-only stale evidence |
| 6 | `eval/fixtures.js` `hostile` | generated | Script/markup/marker injection, RTL override, zero-width characters, a 1,800-character label, paths with spaces, `<`, `#`, `?`, Cyrillic and a 26-level directory, ids `constructor`, `n0`, `data-node`, 80-character ids |
| 7 | `eval/fixtures.js` `noViz` | generated | No visualizations and no impact section |
| 8 | 1, 2, 3, 4, 6 with `--interactive` | | Interactive impact rendering |

The Express manifest ([`eval/express.js`](../eval/express.js)) was written
the way the skill has Claude write one: by reading the code at the tag and
stamping each cited range with `createSourceRef`. The validator caught two
of its authoring mistakes (evidence stamped but never cited,
`evidence.uncited`) before it was complete. Express is only cloned locally;
no source is sent anywhere. The case is optional because it needs a
network clone; everything else is deterministic and offline.

Limitations of the evaluation: one real repository, analysed by hand
rather than by a Claude Code session running the skill; large graphs are
synthetic and regular; one browser engine (Chrome); one machine.

## End-to-end workflow

539 of 539 expectations held in the final run (`--express --scale
--browser`). Per case: `validate` exits 0; `render` writes exactly
`index.html` and `manifest.json`, `manifest.json` byte-equal to the
input, a valid marker for the last history entry; the static page has no
script; a repeated render is `in-sync` and byte-identical; the interactive
page has exactly one script, allowed by hash; rendering static again
afterwards restores the first static bytes. Express: rendering added
nothing to the checkout except `docs/features/request-routing/`.

| Path | Result |
|---|---|
| Manifest not JSON / file missing | exit 1, step `manifest` |
| Schema violation / schema version 2.0.0 | exit 1, step `validation` |
| Claim cites unknown evidence id | exit 1, `ref.unknown` at `/analysis/components/0/evidence/0` |
| Visualization names unknown component | exit 1, step `validation` |
| Evidence path `../../../etc/passwd`, or a symlink to `/etc/hosts` | exit 1, step `validation`; nothing read outside |
| Moved (2 lines added above) | exit 3, `moved → relocate` with `movedTo`; render refused, output untouched; `--acknowledge` has no effect |
| Changed | exit 3, `changed → reanalyze` |
| Missing file / renamed file | exit 3, `missing → reanalyze` (a rename is `missing`, as documented) |
| Ambiguous (cited line shifted and duplicated) | exit 3, `ambiguous → review` |
| Manual-only stale | refused without `--acknowledge`; with it written, exit 3, shown as "unverified: changed", no code |
| Express manifest at `4.19.2` | exit 0: the cited routing code is byte-identical, so the evidence is current |
| Express manifest at `v5.0.0` (router moved to its own package) | exit 3: 17 missing (all of `lib/router/*`, `lib/middleware/*`), 5 changed, 1 moved (`createApplication` 37–57 → 36–56); every entry lists its citing claims; the manual-only entry is `review`; render refused, output untouched |
| Excerpt text wrong / unknown id / not an array | exit 1, step `excerpts` |
| Missing `--repo` or `--excerpts`, `--repo` not a directory | exit 2 |
| `outputDir` `../escape`, absolute, `docs/../..`, backslash; config not JSON | exit 1, step `config` |
| `.featurelens.json` is a directory | exit 1, step `config` (crashed before, F-3) |
| `docs/` or the feature folder a symlink out of the repository; the folder path a file | exit 1, step `output`; nothing created outside |
| `docs/` a symlink inside the repository | written there |
| `index.html` a symlink to a file outside | exit 1; target unchanged |
| Hand-edited `index.html` | exit 1, `hash-mismatch`; file kept |
| Unmarked `index.html`; `index.html` without `manifest.json`; another feature's folder | exit 1, step `existing-output` |
| Update, then the older manifest | exit 1, `history-regression` / `older` |
| New document over an existing one | exit 1, `history-regression` |
| `--interactive` without an impact diagram | byte-identical to static, no script |

## Performance and size

In-process medians (Node startup excluded) and whole CLI runs.

| Case | Components / relationships / evidence | Impact nodes / edges | Validate | Impact model | Render static / interactive | CLI render | HTML static / interactive |
|---|---|---|---|---|---|---|---|
| sample-shop | 8 / 6 / 16 | 4 / 3 | 2.4 ms | 0.1 ms | 1.9 / 1.6 ms | 71 ms | 104 / 112 KB |
| Express | 11 / 12 / 23 | 8 / 7 | 2.6 ms | 0.1 ms | 2.0 / 2.0 ms | 65 ms | 144 / 152 KB |
| many groups | 44 / 94 / 44 | 42 / 90 | 2.9 ms | 0.5 ms | 4.0 / 3.6 ms | 77 ms | 232 / 246 KB |
| layered 6×10 | 60 / 100 / 60 | 33 / 52 | 8.5 ms | 0.2 ms | 4.6 / 4.1 ms | 86 ms | 244 / 256 KB |
| hub, 120 dependents | 128 / 128 / 128 | 123 / 122 | 17 ms | 0.5 ms | 5.4 / 5.1 ms | 98 ms | 497 / 517 KB |
| layered 10×40 | 400 / 720 / 400 | 105 / 185 | 48 ms | 0.9 ms | 45 / 40 ms | 185 ms | 1.4 / 1.4 MB |
| hub, 500 dependents | 508 / 508 / 508 | 503 / 502 | 59 ms | 2.3 ms | 21 / 21 ms | 180 ms | 2.0 / 2.0 MB |
| layered 20×50 | 1,000 / 2,850 / 1,000 | 580 / 1,605 | 116 ms | 5.2 ms | 52 / 52 ms | 323 ms | 5.3 / 5.4 MB |

Interactive mode adds the constant script and style (7 KB) plus about
50–65 bytes per impact node and edge (the `data-*` references on the
drawing and on the text version).
Most of the page size is the evidence catalog and the text versions, not
the SVG.

**Stale detection.** Current evidence costs one hash. A stale entry is
looked up in its whole file: one hash per line of the file, over as many
lines as the entry has. Worst case measured: 100 changed 40-line entries
in one 20,000-line file validate in 3.7 s. Express at `v5.0.0` (23 stale
entries): 58 ms for the whole CLI run. Not optimized; no realistic case
was slow.

**Browser.** 84 page loads (11 cases × static/interactive × 390/1280 ×
light/dark). Load time under 100 ms for the real repositories (up to
200 ms for the first load of a fresh page), 0.3 s for
the 400-component page and up to 1.0 s for the 5.3 MB 1,000-component
page. Selecting the most connected node took at most 2.2 ms (502
highlighted edges). Page-level horizontal overflow: 0 px in every load.
Diagrams wider than the column scroll inside their container: the widest
drawn was 112,936 px (500 nodes in one layer).

**Limits.** No size limit is enforced. The envelope above (1,000
components, 2,850 relationships, 1,000 evidence entries, 5.3 MB) is what
was tested; beyond it, output stays correct but pages grow linearly and
large diagrams stop being readable (F-4, F-8). The text version is the
complete account at any size.

## Browser tests: policy

Before: without Chrome, the browser suite was skipped as a whole and its
11 tests disappeared from the counts (`tests 393 … skipped 0`), so a run
with no browser coverage looked like a smaller, fully passing run (F-1).

Now:

| Command | No Chrome | Chrome |
|---|---|---|
| `npm test` | each browser test reported as skipped (`skipped 11`, with the reason), exit 0 | all run |
| `npm run test:browser` | every browser test fails (`fail 11`: "browser tests required"), exit 1 | all run |
| `npm run check:release` | fails (tests run with Chrome required) | tests, example, full matrix with browser review |
| `node eval/run.js --browser` | expectations still checked; exit 4, "Browser review NOT RUN" | review runs |

`FEATURELENS_REQUIRE_BROWSER=1` turns a missing browser into a failure
for any run; `CHROME_PATH` chooses the browser. Trade-off: local
development stays convenient (no browser needed, but the skip is visible
in the summary), while CI and releases must opt into the required mode;
`test/browser-policy.test.js` keeps both behaviours from regressing. No CI
framework or dependency was added.

## Findings

| # | Severity | Finding | Reproduction | Status |
|---|---|---|---|---|
| F-1 | Medium | Browser tests vanished from the counts without Chrome; nothing required them | `CHROME_PATH=/nonexistent npm test` → `tests 393, skipped 0`, exit 0 | **Fixed**: per-test skip, `FEATURELENS_REQUIRE_BROWSER`, `test:browser`, `check:release`. Test: `test/browser-policy.test.js` |
| F-2 | Medium | `createManifest`/`recordUpdate` validated the in-memory object, where an optional field set to `undefined` (e.g. `symbol: e.symbol`, `parent: undefined` in a build script) is a schema error, but `serializeManifest` drops it. The history entry recorded `valid: false, errorCount: 2` for a manifest that validates, and the page said "Last recorded validation: invalid, 2 error(s)" | Build a manifest with `parent: undefined` | **Fixed**: both copy their input as JSON data first, so what is validated and recorded is what is written. Test: `test/build.test.js` |
| F-3 | Low | An unreadable `.featurelens.json` (a directory, or no permission) crashed `render` and `git-info` with a stack trace; nothing was written | `mkdir .featurelens.json && featurelens render …` | **Fixed**: `ConfigError`, step `config`. Tests: `test/config.test.js`, eval |
| F-4 | Medium | Impact diagrams draw every edge as a straight line and route none. Edges that skip layers run through the nodes between their ends and are hidden behind them; long edges between adjacent layers enter the target layer from the side and run behind its other nodes, looking like links between neighbours. Architecture views route skip-layer edges but have the second effect | Edges through a node that is not their end: many groups (one column): **49 of 90 impact edges hidden**; hub with 120 dependents: 116/122 impact, 123/128 architecture; layered 6×10: 8/52 impact; Express: 1/12 architecture (Layer → Application handlers crosses "query middleware"); sample-shop: 0 | **Not fixed.** Every relationship is still in the text version and, interactively, in the selected node's details. Fixing it changes the geometry of every impact diagram, which Phase 3D promised to keep byte-identical, so it needs its own layout contract. The metric is reported by `eval/run.js` (`edgesThroughNodes`) as acceptance for that work |
| F-5 | Low | In a single-column architecture view, all bent skip-layer edges use the same channel beside the column, on top of each other and of the group box border | many-groups case, "Bounded contexts" | Not fixed (same routing work as F-4) |
| F-6 | Low | Stale lookup cost grows with file length × entry length per stale entry | 3.7 s for the worst case above | Not fixed; measured and documented |
| F-7 | Low | `evidence.unlisted-file` is reported once per evidence entry, not once per file (44 warnings for one file) | `manyGroups` without `analysis.files` | Not fixed: warning granularity is part of the validation output |
| F-8 | Info | Very wide layers make very wide diagrams (224 px per node); correct and contained, but not navigable without pan/zoom | hub with 500 dependents: 112,936 px | Documented; pan and zoom are out of scope |
| F-9 | Info | `validate` checks evidence by hash, not by revision: a manifest stamped at `4.21.2` is current at `4.19.2` because the cited code is identical, while the page still shows the manifest's revision | Express at `4.19.2` | By design; documented |

Manual review (screenshots of every case at 390/1280, light/dark, plus the
selected state): labels wrap and truncate with the full text in the node's
`<title>` and the text version; group headings are cut to the box;
stale evidence reads "unverified: changed … The code is not shown because
it no longer matches"; derived items say "not a claim · no evidence";
selection dims the rest, thickens the node border and bolds the label;
Escape clears it and keeps focus on the node; dark mode keeps contrast;
hostile text is shown as text. No finding besides F-4, F-5 and F-8.

## Security and safety audit

- `src/` and `bin/`: no `eval`, `Function`, network module, `fetch`, URL
  or shell; `require` only for two bundled JSON files; git runs through
  `execFileSync` without a shell. Only `src/output/writer.js` writes.
- The page script builds no markup from strings (no `innerHTML`,
  `document.write`, inline handlers). CSP unchanged: `default-src 'none'`,
  scripts only by hash in interactive pages.
- In Chrome, 84 loads including the hostile case: 0 CSP violations, 0
  dialogs, 0 elements with event-handler attributes, 0 images; exactly 0
  scripts in static pages and 1 in interactive pages.
- Output confinement: every symlink case above is refused and nothing was
  created outside the repository; the writer, output checks and history
  checks were not changed.
- Metadata: a remote URL with `user:token@` is recorded without
  credentials; a git email is not recorded unless `includeEmail` is true.
  `manifest.json` is written exactly as given, and the page shows only
  excerpts the caller supplied.

Intentional breakages, each restored afterwards; all were caught:

| Break | `npm test` | `eval/run.js` |
|---|---|---|
| Escaping disabled | 18 failures | 7 failures |
| History regression check disabled | 8 failures | 4 failures |
| Moved evidence classified as changed | 5 failures | 3 failures |
| Symlink target confinement removed from the writer | 5 failures | "nothing was written outside the repository" fails |
| Browser suite skipped as a whole again | `test/browser-policy.test.js` fails | |
| `createManifest` keeps `undefined` fields (F-2 reverted) | 1 failure | |
