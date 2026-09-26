import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Version of the FeatureLens tool, from package.json. */
export const TOOL_VERSION = require('../package.json').version;

/**
 * Version of the manifest schema this tool writes. Minor bumps are
 * backward-compatible additions; a major bump requires a migration.
 */
export const SCHEMA_VERSION = '1.0.0';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Decide whether this tool can read a manifest written with `version`.
 * Same major and a minor no newer than ours is supported. A newer minor may
 * add fields this tool's schema would reject, so we ask for an upgrade
 * instead of reporting confusing "not an allowed property" errors.
 *
 * @param {unknown} version
 * @returns {string | null} a reason it is unsupported, or null when supported
 */
export function checkSchemaVersion(version) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    return `schemaVersion must be a semver string like "${SCHEMA_VERSION}", got ${JSON.stringify(version)}`;
  }
  const [major, minor] = version.split('.').map(Number);
  const [ourMajor, ourMinor] = SCHEMA_VERSION.split('.').map(Number);
  if (major !== ourMajor) {
    return `schema version ${version} is not supported; this tool reads ${ourMajor}.x manifests`;
  }
  if (minor > ourMinor) {
    return `schema version ${version} is newer than this tool supports (${SCHEMA_VERSION}); upgrade featurelens`;
  }
  return null;
}
