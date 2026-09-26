import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema } from '../src/schema/json-schema.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'tags'],
  properties: {
    id: { $ref: '#/$defs/id' },
    tags: { type: 'array', minItems: 1, items: { enum: ['a', 'b'] } },
    count: { type: 'integer', minimum: 0 },
    at: { type: 'string', format: 'date-time' },
    'a/b': { const: 1 },
  },
  $defs: { id: { type: 'string', pattern: '^[a-z]+$' } },
};

test('accepts a valid value', () => {
  assert.deepEqual(validateSchema({ id: 'abc', tags: ['a'], count: 0, at: '2026-01-01T00:00:00Z' }, schema), []);
});

test('reports errors with JSON pointer paths', () => {
  const errors = validateSchema({ id: 'ABC', tags: ['c'], count: 1.5, extra: true, 'a/b': 2 }, schema);
  assert.deepEqual(errors.map((e) => e.path).sort(), ['/a~1b', '/count', '/extra', '/id', '/tags/0']);
});

test('reports missing required properties and minItems', () => {
  const errors = validateSchema({ tags: [] }, schema);
  assert.deepEqual(errors.map((e) => e.message).sort(), ['missing required property "id"', 'must have at least 1 items']);
});

test('rejects invalid date-times', () => {
  for (const at of ['2026-01-01', '2026-13-01T00:00:00Z', 'yesterday']) {
    assert.equal(validateSchema({ id: 'a', tags: ['a'], at }, schema).length, 1, at);
  }
});

test('distinguishes arrays, null and objects', () => {
  assert.equal(validateSchema([], { type: 'object' }).length, 1);
  assert.equal(validateSchema(null, { type: 'object' }).length, 1);
  assert.equal(validateSchema({}, { type: 'array' }).length, 1);
});

test('throws on unsupported keywords instead of silently ignoring them', () => {
  assert.throws(() => validateSchema(1, { oneOf: [] }), /Unsupported JSON Schema keyword "oneOf"/);
  assert.throws(() => validateSchema(1, { $ref: 'http://x' }), /Only local \$ref/);
});
