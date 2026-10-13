'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateItem, validatePlan, newPublicId, TACTIC_ICONS } = require('../tactic-validate');

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

test('unknown kind, width and squad are rejected', () => {
  for (const input of [
    { kind: 'circle', geometry: line },
    { kind: 'pencil', geometry: line, width: 0 },
    { kind: 'pencil', geometry: line, width: 4 },
    { kind: 'pencil', geometry: line, width: 1.5 },
    { kind: 'pencil', geometry: line, squad: 'a' },
    { kind: 'pencil', geometry: line, squad: 0 },
  ]) assert.equal(validateItem(input, { create: true }).ok, false, JSON.stringify(input));
});

test('on update every field is optional but at least one is meaningful', () => {
  assert.deepEqual(validateItem({ width: 1, __kind: 'pencil' }, {}).value, { width: 1 });
  assert.deepEqual(validateItem({ squad: null, __kind: 'pencil' }, {}).value, { squad_id: null });
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
  for (const __kind of ['constructor', 'toString', 'circle', '__proto__', 5, {}]) {
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

const pts = (n) => Array.from({ length: n }, (_, i) => [(i % 10) / 10, 0.5]);

test('arrow: 2..50 points, no label or icon', () => {
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(2) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(50) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(51) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(1) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(2), label: 'x' }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(2), icon: 'enemy' }, { create: true }).ok, false);
});

test('zone: 3..200 points, optional label up to 60, self-intersection is fine', () => {
  const bow = [[0, 0], [1, 1], [1, 0], [0, 1]];
  assert.equal(validateItem({ kind: 'zone', geometry: bow }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(2) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(200) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(201) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(3), label: 'Точка сбора' }, { create: true }).value.label, 'Точка сбора');
  assert.equal(validateItem({ kind: 'zone', geometry: pts(3), label: '   ' }, { create: true }).value.label, null);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(3), label: 'x'.repeat(61) }, { create: true }).ok, false);
});

test('marker: a single point, icon from the set (default question), label up to 60', () => {
  const m = validateItem({ kind: 'marker', geometry: [0.123456, 0.5], icon: 'sniper', label: ' Снайпер ' }, { create: true });
  assert.deepEqual(m.value, { kind: 'marker', geometry: [0.12346, 0.5], width: 2, squad_id: null, icon: 'sniper', label: 'Снайпер' });
  assert.equal(validateItem({ kind: 'marker', geometry: [0.5, 0.5] }, { create: true }).value.icon, 'question');
  for (const icon of TACTIC_ICONS) assert.equal(validateItem({ kind: 'marker', geometry: [0, 0], icon }, { create: true }).ok, true);
  assert.equal(TACTIC_ICONS.length, 8);
  for (const bad of [{ icon: 'skull' }, { icon: 5 }, { geometry: [0.5] }, { geometry: [[0.5, 0.5]] }, { geometry: [2, 0] }, { label: 'x'.repeat(61) }]) {
    assert.equal(validateItem({ kind: 'marker', geometry: [0.5, 0.5], ...bad }, { create: true }).ok, false, JSON.stringify(bad));
  }
});

test('text: a point and a label of 1..120 characters is required', () => {
  assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label: 'Идём сюда' }, { create: true }).ok, true);
  for (const label of [undefined, '', '   ', 'x'.repeat(121), 'a\u0000b', 'line\nbreak', 5]) {
    assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label }, { create: true }).ok, false, String(label));
  }
  assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label: 'x'.repeat(120) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label: 'ok', icon: 'enemy' }, { create: true }).ok, false);
});

test('pencil still takes neither label nor icon; HTML in a label is kept as plain text', () => {
  assert.equal(validateItem({ kind: 'pencil', geometry: pts(2), label: 'x' }, { create: true }).ok, false);
  const html = '<img src=x onerror=alert(1)>';
  assert.equal(validateItem({ kind: 'text', geometry: [0.1, 0.1], label: html }, { create: true }).value.label, html);
});

test('update checks fields against the stored kind', () => {
  assert.deepEqual(validateItem({ label: 'Новый', __kind: 'text' }, {}).value, { label: 'Новый' });
  assert.deepEqual(validateItem({ geometry: [0.4, 0.4], __kind: 'marker' }, {}).value, { geometry: [0.4, 0.4] });
  assert.equal(validateItem({ geometry: [0.4, 0.4], __kind: 'pencil' }, {}).ok, false);
  assert.equal(validateItem({ label: '', __kind: 'text' }, {}).ok, false);
  assert.equal(validateItem({ icon: 'enemy', __kind: 'text' }, {}).ok, false);
});
