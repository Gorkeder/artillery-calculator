'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../clan-validate');

test('clanKey folds case and ё', () => {
  assert.equal(v.clanKey('  Ёжики '), 'ежики');
  assert.equal(v.clanKey('ALF'), 'alf');
});

test('validateClan', () => {
  assert.deepEqual(v.validateClan({ tag: ' ВОЛ ', name: '  Серые   волки ', description: ' d ' }, { create: true }),
    { ok: true, value: { tag: 'ВОЛ', name: 'Серые волки', description: 'd' } });
  for (const tag of ['A', 'TOOLONG', 'A-B', 'a b', '', 5]) {
    assert.equal(v.validateClan({ tag, name: 'Name' }, { create: true }).error, 'tag_invalid', String(tag));
  }
  assert.equal(v.validateClan({ tag: 'AB', name: 'ab' }, { create: true }).error, 'name_invalid');
  assert.equal(v.validateClan({ tag: 'AB', name: 'x'.repeat(41) }, { create: true }).error, 'name_invalid');
  assert.equal(v.validateClan({ tag: 'AB', name: 'bad\nname' }, { create: true }).error, 'name_invalid');
  assert.equal(v.validateClan({ description: 'x'.repeat(501) }).error, 'description_invalid');
  assert.deepEqual(v.validateClan({ owner_id: 3 }), { ok: true, value: {} }, 'unknown fields are dropped');
  assert.equal(v.validateClan({}, { create: true }).ok, false, 'tag and name are required on create');
});

test('validateRole', () => {
  assert.deepEqual(
    v.validateRole({ name: 'Офицер', color: '#aabbcc', perms: ['kick', 'invite'], draw_all_squads: true, squads: [3, 1] }, { create: true }),
    { ok: true, value: { name: 'Офицер', color: '#aabbcc', perms: 48, draw_all_squads: 1, squads: [3, 1] } },
  );
  assert.equal(v.validateRole({}, { create: true }).ok, false);
  assert.equal(v.validateRole({ name: 'x'.repeat(31) }).ok, false);
  assert.equal(v.validateRole({ perms: ['fly'] }).ok, false);
  assert.equal(v.validateRole({ color: 'red' }).ok, false);
  assert.equal(v.validateRole({ draw_all_squads: 1 }).ok, false);
  assert.equal(v.validateRole({ squads: [1, 1] }).ok, false);
  assert.equal(v.validateRole({ squads: [0] }).ok, false);
  assert.equal(v.validateRole({ squads: Array.from({ length: 11 }, (_, i) => i + 1) }).ok, false);
});

test('validateSquad and validateIdList', () => {
  assert.deepEqual(v.validateSquad({ name: ' Альфа ', color: '#112233' }, { create: true }),
    { ok: true, value: { name: 'Альфа', color: '#112233' } });
  assert.equal(v.validateSquad({}, { create: true }).ok, false);
  assert.equal(v.validateSquad({ color: '#12' }).ok, false);
  assert.deepEqual(v.validateIdList([2, 1], 5), { ok: true, value: [2, 1] });
  assert.equal(v.validateIdList('1', 5).ok, false);
  assert.equal(v.validateIdList([1, 2, 3], 2).ok, false);
});

test('validateInviteOptions', () => {
  assert.deepEqual(v.validateInviteOptions({}), { ok: true, value: { ttl: '7d', maxUses: null } });
  assert.deepEqual(v.validateInviteOptions({ ttl: null, maxUses: 5 }), { ok: true, value: { ttl: null, maxUses: 5 } });
  assert.equal(v.validateInviteOptions({ ttl: '30d' }).ok, false);
  assert.equal(v.validateInviteOptions({ maxUses: 0 }).ok, false);
  assert.equal(v.validateInviteOptions({ maxUses: 101 }).ok, false);
  assert.equal(v.validateInviteOptions({ maxUses: 1.5 }).ok, false);
});
