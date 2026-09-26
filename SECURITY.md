# Security policy

## Supported versions

Security fixes are made for the latest released version of FeatureLens.

| Version | Supported |
|---|---|
| 1.0.x | Yes |

## Reporting a vulnerability

Please do **not** report security vulnerabilities in public GitHub issues,
discussions or pull requests.

Report them privately through GitHub's private vulnerability reporting:
open the repository's **Security** tab and choose **Report a
vulnerability**. Include:

- the FeatureLens version (`node bin/featurelens.js --version`)
- what an attacker controls (a manifest, a draft, an excerpt file, the
  repository contents, `.featurelens.json`, existing output, …)
- the command you ran and what happened
- a minimal reproduction, if you have one

Maintainers will acknowledge the report, investigate, and coordinate a fix
and disclosure with you. Please give them reasonable time to release a fix
before disclosing publicly.

## Threat model

FeatureLens runs locally, as you, inside Claude Code. It reads the
repository you point it at and writes documentation into it. The inputs it
treats as untrusted are the manifest and draft (which Claude writes), the
excerpt file, repository contents, `.featurelens.json`, and any existing
output folder. The generated page is treated as something that may be
opened by others, so it must not execute or load anything unexpected.

FeatureLens does not attempt to protect against a malicious local user or
a compromised Node.js installation, and it does not verify that Claude's
analysis is correct; it verifies that the cited evidence exists and is
current (see "Limits" below).

## What FeatureLens enforces

### Output and path confinement

- Documents are written only by `render`, only through the checked
  writer (`src/output/writer.js`), and only inside the repository.
- `outputDir` in `.featurelens.json` must be a relative POSIX path inside
  the repository; absolute paths, `..` and backslashes are refused.
- Every existing path component is resolved through symlinks before
  anything is created. A symlink that leads outside the repository is
  refused, and nothing is created outside it.
- Files are written atomically. A leftover temporary file or symlink is
  removed rather than followed.
- `build` and `update` write only the working manifest named by `--out`,
  and refuse an `--out` inside the output directory.
- Cited evidence files must resolve inside the repository, including
  through symlinks.

### Refusal instead of overwriting

- Existing output is replaced only when it is intact FeatureLens output:
  `index.html` carries a marker with a SHA-256 hash of the page, and a
  hand-edited, unmarked or foreign page is refused.
- A manifest that rewrites, reorders or drops existing history
  (`history-regression`), or that changes a manual section without a
  history entry recording it (`manual-section-changed`), is refused.
- The CLI has no `--force` option.
- Stale evidence blocks `update` and `render` (the write gate).

### Generated pages

- Every page carries a Content-Security-Policy with `default-src 'none'`,
  `base-uri 'none'` and `form-action 'none'`, so it cannot load scripts,
  styles, fonts, frames or other resources from anywhere, or submit forms.
  Images are allowed only as `data:` URIs.
- Static pages (the default) contain no script.
- Interactive pages (`render --interactive`) contain exactly one constant
  inline script, allowed by its SHA-256 hash in `script-src`. There is no
  `'unsafe-inline'` or `'unsafe-eval'` for scripts. The script builds no
  markup from strings.
- Inline styles are allowed (`style-src 'unsafe-inline'`); the page's own
  stylesheet is inline.
- All text from the manifest and excerpts is HTML-escaped.

### Network and process behavior

- The CLI makes no network requests; `src/` and `bin/` contain no network
  modules or external URLs (checked by `test/boundaries.test.js`).
- `git` is run with `execFileSync`, without a shell.
- No `eval` or `Function` constructor is used.

### Personal data and credentials

- `user:token@` credentials are stripped from https remote URLs before
  they are recorded.
- Email addresses are not recorded unless `.featurelens.json` sets
  `attribution.includeEmail` to `true`.
- The page shows only the source excerpts Claude supplies; `render` never
  reads source files itself.

## Limits

- **Evidence re-stamping is trust-based.** During an update, evidence is
  re-stamped when Claude removes its `snippetHash`. FeatureLens cannot
  verify that the claims citing it were actually re-checked.
- **Documents can contain source code.** Excerpts are copies of your
  code. Review generated documents before publishing them outside your
  organization.
- Interactive pages rely on the browser enforcing CSP script hashes; they
  are tested in Chrome.
