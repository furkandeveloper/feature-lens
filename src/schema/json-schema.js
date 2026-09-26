// Minimal JSON Schema validator covering the subset FeatureLens schemas use.
// Kept dependency-free so the Claude Code skill can run without `npm install`.
// Unsupported keywords throw at validation time rather than being silently ignored.

const SUPPORTED = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'minItems', 'format',
]);

// RFC 3339 date-time, e.g. 2026-09-23T18:30:00Z or 2026-09-23T18:30:00.123+02:00
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * @typedef {{ path: string, keyword: string, message: string }} SchemaError
 */

/**
 * Validate `value` against `schema`. Returns a list of errors; empty means valid.
 * @param {unknown} value
 * @param {object} schema root schema (used to resolve local `#/$defs/...` refs)
 * @returns {SchemaError[]}
 */
export function validateSchema(value, schema) {
  const errors = [];
  check(value, schema, '', schema, errors);
  return errors;
}

function check(value, schema, path, root, errors) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`Unsupported JSON Schema keyword "${key}" at ${path || '/'}`);
  }

  if (schema.$ref) {
    check(value, resolveRef(schema.$ref, root), path, root, errors);
    return;
  }

  const err = (keyword, message) => errors.push({ path: path || '/', keyword, message });

  if ('const' in schema && value !== schema.const) {
    err('const', `must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    err('enum', `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
    return;
  }
  if (schema.type && !matchesType(value, schema.type)) {
    err('type', `must be of type ${schema.type}`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) err('minLength', `must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err('maxLength', `must have at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) err('pattern', `must match pattern ${schema.pattern}`);
    if (schema.format === 'date-time' && !(DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)))) {
      err('format', 'must be an RFC 3339 date-time');
    }
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    err('minimum', `must be >= ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err('minItems', `must have at least ${schema.minItems} items`);
    if (schema.items) value.forEach((item, i) => check(item, schema.items, `${path}/${i}`, root, errors));
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) err('required', `missing required property "${key}"`);
    }
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${escapePointer(key)}`;
      if (key in props) {
        check(child, props[key], childPath, root, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: childPath, keyword: 'additionalProperties', message: 'is not an allowed property' });
      } else if (isPlainObject(schema.additionalProperties)) {
        check(child, schema.additionalProperties, childPath, root, errors);
      }
    }
  }
}

function matchesType(value, type) {
  switch (type) {
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: throw new Error(`Unsupported JSON Schema type "${type}"`);
  }
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`Only local $ref values are supported, got "${ref}"`);
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (!node) throw new Error(`Unresolvable $ref "${ref}"`);
  return node;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapePointer(key) {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
