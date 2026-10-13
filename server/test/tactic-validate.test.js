'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateItem, validatePlan, newPublicId } = require('../tactic-validate');

const line = [[0, 0], [0.5, 0.5], [1, 1]];

test('a pencil stroke is accepted and rounded to 5 decimals', () => {
  const r = validateItem({ kind: 'pencil', geometry: [[0.123456789, 0.1], [0.2, 0.3]], width: 3, squad: 4 }, { create: true });
  assert.deepEqual(r, { ok: true, value: { kind: 'pencil', geometry: [[0.12346, 0.1], [0.2, 0.3]], width: 3, squad_id: 4 } });
});

test('defaults: width 2 and squad null (общий)', () => {
  const r = validateItem({ kind: 'pencil', geometry: line }, { create: true });
  assert.equal(r.value.width, 2);
  assert.equal(r.value.squad_id, null);
});

test('bad strokes are rejected', () => {
  const bad = [
    [],
    [[0.1, 0.1]],
    'abc',
    [[0.1, 'x'], [0.2, 0.2]],
    [[0.1, 0.1], [0.2]],
    [[0.1, 0.1], [NaN, 0.2]],
    [[0.1, 0.1], [1.2, 0.2]],
    [[0.1, 0.1], [-0.1, 0.2]],
    [[0.1, 0.1], [0.2, 0.2, 0.3]],
    Array.from({ length: 2001 }, () => [0.5, 0.5]),
  ];
  for (const geometry of bad) {
    assert.equal(validateItem({ kind: 'pencil', geometry }, { create: true }).ok, false, JSON.stringify(geometry).slice(0, 40));
  }
  assert.equal(validateItem({ kind: 'pencil', geometry: Array.from({ length: 2000 }, () => [0.5, 0.5]) }, { create: true }).ok, true);
});

test('unknown kind, width and squad are rejected; arrow is not yet supported', () => {
  for (const input of [
    { kind: 'circle', geometry: line },
    { kind: 'arrow', geometry: line },
    { kind: 'pencil', geometry: line, width: 0 },
    { kind: 'pencil', geometry: line, width: 4 },
    { kind: 'pencil', geometry: line, width: 1.5 },
    { kind: 'pencil', geometry: line, squad: 'a' },
    { kind: 'pencil', geometry: line, squad: 0 },
  ]) assert.equal(validateItem(input, { create: true }).ok, false, JSON.stringify(input));
});

test('on update every field is optional but at least one is meaningful', () => {
  assert.deepEqual(validateItem({ width: 1 }, {}).value, { width: 1 });
  assert.deepEqual(validateItem({ squad: null }, {}).value, { squad_id: null });
  assert.equal(validateItem({ kind: 'zone' }, {}).ok, false, 'kind cannot be changed');
});

test('plan title: trimmed 1..60, no control characters', () => {
  assert.deepEqual(validatePlan({ title: '  Штурм  ' }, { create: true }), { ok: true, value: { title: 'Штурм' } });
  for (const title of ['', '   ', 'x'.repeat(61), 'a\nb', 5, undefined]) {
    assert.equal(validatePlan({ title }, { create: true }).ok, false);
  }
});

test('newPublicId is 12 base62 characters and different each time', () => {
  const a = newPublicId();
  assert.match(a, /^[0-9A-Za-z]{12}$/);
  assert.notEqual(a, newPublicId());
});

test('update with a hostile __kind is rejected without throwing', () => {
  for (const __kind of ['constructor', 'toString', 'arrow', '__proto__', 5, {}]) {
    const r = validateItem({ geometry: line, __kind }, {});
    assert.equal(r.ok, false, String(__kind));
  }
  assert.equal(validateItem({ geometry: line, __kind: 'pencil' }, {}).ok, true);
});

test('non-object input is rejected without throwing', () => {
  for (const input of [null, undefined, 'abc', 5, [], [1]]) {
    assert.equal(validateItem(input, { create: true }).ok, false);
    assert.equal(validateItem(input, {}).ok, false);
    assert.equal(validatePlan(input, { create: true }).ok, false);
  }
});
