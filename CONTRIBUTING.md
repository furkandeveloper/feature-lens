# Contributing to FeatureLens

Thanks for your interest in FeatureLens. Bug reports, fixes, tests and
documentation improvements are welcome. Please read this guide before
opening a pull request, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js 20 or newer
- git
- Chrome or Chromium, for the browser tests (optional for everyday work,
  required for `npm run test:browser` and `npm run check:release`)
- [Claude Code](https://claude.com/claude-code), to validate and try the
  plugin

## Getting started

```sh
git clone <repository-url> feature-lens
cd feature-lens
npm test
```

There is nothing to install: FeatureLens has no dependencies, runtime or
development. To try your changes as a plugin, start Claude Code in another
repository with `claude --plugin-dir path/to/feature-lens`.

## Checks

| Command | What it runs |
|---|---|
| `npm test` | All unit, integration and CLI tests. Browser tests are reported as skipped when no Chrome is found. |
| `npm run test:browser` | The headless Chrome tests of the interactive impact graph only. Fails if no Chrome is found. Set `CHROME_PATH` to choose a browser. |
| `npm run validate:example` | Validates the bundled example manifest against its source files. |
| `npm run eval` | The end-to-end evaluation matrix through the real CLI ([docs/EVALUATION.md](docs/EVALUATION.md)). |
| `npm run check:release` | All tests with Chrome required, the example, and the evaluation matrix with a browser review. Run this before a pull request that touches rendering, output or the workflow. |
| `claude plugin validate .` | The plugin and marketplace metadata in `.claude-plugin/`. |

The evaluation runner has optional cases:

```sh
node eval/run.js --scale --browser --out <dir>   # large graphs, Chrome review; keeps outputs and screenshots in <dir>
node eval/run.js --express <express checkout>    # the Express case; needs a local clone of expressjs/express
```

Keep evaluation output and any cloned repositories outside this
repository (or in an ignored directory); they are not part of the project.

## Principles to preserve

FeatureLens makes a small set of guarantees. Changes must keep them, and a
pull request that needs to relax one should say so explicitly and explain
why:

- **No dependencies.** No runtime or development dependencies
  (`test/boundaries.test.js` checks this). Use Node's standard library.
- **Claude analyzes, the CLI verifies.** The CLI does not inspect or
  analyze repositories, discover files or list changed files. Repository
  reasoning belongs to Claude Code and the skill.
- **No network access** in `src/` or `bin/` (checked by
  `test/boundaries.test.js`).
- **Deterministic rendering.** The same manifest and excerpts produce the
  same bytes. Diagrams draw only what the manifest declares.
- **Security of generated pages.** The Content-Security-Policy stays
  `default-src 'none'`. Static pages have no script; interactive pages
  allow only the constant script by its hash. No `'unsafe-inline'` or
  `'unsafe-eval'` for scripts, and all text goes through the escaping
  helpers.
- **Path confinement.** Only `src/output/writer.js` writes documents, and
  only inside the repository, with symlinks resolved.
- **Manual section and history protection.** Manual sections are never
  rewritten, and history is only ever appended to.
- **Refuse rather than guess.** No `--force`, and no silent fallbacks.
- **Schema compatibility.** The manifest schema is versioned
  ([docs/MANIFEST.md](docs/MANIFEST.md#versioning)). Don't change it
  without an agreed design; a breaking change needs a major version and a
  migration.

## Coding style

- Plain JavaScript ES modules, no build step, no transpiler.
- Match the surrounding code: small pure functions, JSDoc types on
  exported functions, and comments that explain why rather than what.
- Keep the module boundaries described in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): `bin/` wires modules
  together, the renderer is pure, and only the writer writes.
- Errors carry a stable code and, for manifests, a JSON Pointer.

## Tests

- Add or update tests with every behavior change or bug fix. Tests use the
  built-in `node:test` runner and live in `test/`.
- Don't weaken or delete an existing test to make a change pass. If a test
  is wrong, explain why in the pull request.
- Browser behavior of the interactive graph belongs in
  `test/interactive-browser.test.js`.
- If you change the skill, keep `test/plugin.test.js` passing: it checks
  that every command and flag the skill uses exists in the CLI.

## Documentation

Update the documentation that describes what you changed:

- `README.md` for user-facing behavior and commands
- `skills/featurelens/SKILL.md` for anything Claude must do differently
- `docs/MANIFEST.md` for the manifest, validation codes and exit codes
- `docs/ARCHITECTURE.md` for modules, contracts and design decisions
- `CHANGELOG.md` under an "Unreleased" heading

The build and update workflow is documented in all of these; keep the
commands identical everywhere.

## Pull requests

1. Open an issue first for anything larger than a small fix, so the
   approach can be agreed before you invest time.
2. Keep each pull request focused on one change.
3. Run `npm test` (and `npm run check:release` for rendering, output or
   workflow changes) and `claude plugin validate .` if you touched the
   plugin.
4. Fill in the pull request template.

## Reporting bugs

Open a GitHub issue with the bug report template. Include the FeatureLens
version (`node bin/featurelens.js --version`), your operating system and
Node.js version, the command you ran, and its full output (`--json` output
helps). Don't paste private source code; a minimal reproduction is best.

Report security vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue.

## Proposing features

Open a GitHub issue with the feature request template. Describe the
problem first, then the behavior you would like. Check
[docs/ROADMAP.md](docs/ROADMAP.md) and the known limitations in the
README; some are deliberate design decisions recorded in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
