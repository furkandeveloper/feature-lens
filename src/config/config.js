// Loads optional per-repository configuration from `.featurelens.json`.

import fs from 'node:fs';
import path from 'node:path';
import { validateSchema } from '../schema/json-schema.js';

export const CONFIG_FILE = '.featurelens.json';

export const DEFAULT_CONFIG = Object.freeze({
  outputDir: 'docs/features',
  attribution: Object.freeze({
    includeEmail: false,
    includeContributors: true,
    maxContributors: 20,
  }),
});

const configSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    outputDir: { type: 'string', minLength: 1 },
    attribution: {
      type: 'object',
      additionalProperties: false,
      properties: {
        includeEmail: { type: 'boolean' },
        includeContributors: { type: 'boolean' },
        maxContributors: { type: 'integer', minimum: 0 },
      },
    },
  },
};

export class ConfigError extends Error {}

/**
 * Read `.featurelens.json` from `repoRoot` and merge it over the defaults.
 * A missing file yields the defaults; an invalid file throws ConfigError.
 * @param {string} repoRoot
 */
export function loadConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_FILE);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
    throw new ConfigError(`${CONFIG_FILE}: cannot read (${e.code ?? e.message})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`${CONFIG_FILE}: invalid JSON (${e.message})`);
  }

  const errors = validateSchema(parsed, configSchema);
  if (errors.length > 0) {
    throw new ConfigError(`${CONFIG_FILE}: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  }

  const outputDir = parsed.outputDir ?? DEFAULT_CONFIG.outputDir;
  const normalized = path.posix.normalize(outputDir);
  if (path.posix.isAbsolute(outputDir) || normalized.startsWith('..') || outputDir.includes('\\')) {
    throw new ConfigError(`${CONFIG_FILE}: outputDir must be a relative POSIX path inside the repository`);
  }

  return {
    outputDir: normalized.replace(/\/$/, ''),
    attribution: { ...DEFAULT_CONFIG.attribution, ...parsed.attribution },
  };
}
