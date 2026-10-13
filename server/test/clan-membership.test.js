'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clanSetup } = require('./clan-helpers');
const { PERMS } = require('../clan-permissions');

const count = (s, sql, ...args) => s.db.prepare(sql).get(...args).n;

test('a member leaves and loses roles and squads; the owner cannot leave', async (t) => {
  const { s, as, users, makeClan, addMember, grantRole } = await clanSetup(t);
  const id = await makeClan();
  addMember(id, 'bob');
  grantRole(id, 'bob', 'Officer', 1, PERMS.kick);
  const squad = Number(s.db.prepare("INSERT INTO clan_squads (clan_id, name, color) VALUES (?, 'A', '#ffffff')").run(id).lastInsertRowid);
  s.db.prepare('INSERT INTO clan_squad_members (squad_id, user_id) VALUES (?, ?)').run(squad, users.bob.id);
  const r = await as('bob')('POST', `/api/clans/${id}/leave`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.clan, null);
  assert.equal(count(s, 'SELECT COUNT(*) AS n FROM clan_member_roles WHERE user_id = ?', users.bob.id), 0);
  assert.equal(count(s, 'SELECT COUNT(*) AS n FROM clan_squad_members WHERE user_id = ?', users.bob.id), 0);
  const o = await as('alice')('POST', `/api/clans/${id}/leave`, {});
  assert.deepEqual([o.status, o.json.error], [409, 'owner_must_transfer']);
  assert.equal((await as('carol')('POST', `/api/clans/${id}/leave`, {})).status, 404, 'outsider');
});

test('kick follows the hierarchy', async (t) => {
  const { as, users, makeClan, addMember, grantRole } = await clanSetup(t);
  const id = await makeClan();
  for (const who of ['bob', 'carol', 'dave']) addMember(id, who);
  grantRole(id, 'bob', 'Officer', 2, PERMS.kick);
  grantRole(id, 'carol', 'Officer 2', 2, PERMS.kick);
  assert.equal((await as('dave')('DELETE', `/api/clans/${id}/members/${users.carol.id}`)).status, 403, 'no kick flag');
  assert.equal((await as('bob')('DELETE', `/api/clans/${id}/members/${users.carol.id}`)).status, 403, 'equal rank');
  assert.equal((await as('bob')('DELETE', `/api/clans/${id}/members/${users.alice.id}`)).status, 403, 'owner');
  const self = await as('bob')('DELETE', `/api/clans/${id}/members/${users.bob.id}`);
  assert.deepEqual([self.status, self.json.error], [400, 'use_leave']);
  const r = await as('bob')('DELETE', `/api/clans/${id}/members/${users.dave.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.members.map((m) => m.login), ['alice', 'bob', 'carol']);
  assert.equal((await as('alice')('DELETE', `/api/clans/${id}/members/${users.carol.id}`)).status, 200);
  assert.equal((await as('alice')('DELETE', `/api/clans/${id}/members/999`)).status, 404);
});

test('the owner transfers leadership to a member only', async (t) => {
  const { as, users, makeClan, addMember } = await clanSetup(t);
  const id = await makeClan();
  addMember(id, 'bob');
  assert.equal((await as('bob')('POST', `/api/clans/${id}/transfer`, { userId: users.alice.id })).status, 403);
  assert.equal((await as('alice')('POST', `/api/clans/${id}/transfer`, { userId: users.carol.id })).status, 404);
  assert.equal((await as('alice')('POST', `/api/clans/${id}/transfer`, { userId: 'x' })).status, 400);
  const r = await as('alice')('POST', `/api/clans/${id}/transfer`, { userId: users.bob.id });
  assert.equal(r.status, 200);
  assert.equal(r.json.me.isOwner, false);
  assert.deepEqual(r.json.members.filter((m) => m.owner).map((m) => m.login), ['bob']);
  assert.equal((await as('alice')('POST', `/api/clans/${id}/leave`, {})).status, 200, 'former owner may leave');
});

test('settings: clan_settings flag or site admin; uniqueness on rename', async (t) => {
  const { as, makeClan, addMember, grantRole } = await clanSetup(t);
  const id = await makeClan();
  await makeClan('carol', 'BRV', 'Bravo team');
  addMember(id, 'bob');
  assert.equal((await as('bob')('PATCH', `/api/clans/${id}`, { description: 'x' })).status, 403);
  grantRole(id, 'bob', 'Herald', 1, PERMS.clan_settings);
  const r = await as('bob')('PATCH', `/api/clans/${id}`, { description: 'Мы волки', name: 'Wolves' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.clan.name, r.json.clan.description], ['Wolves', 'Мы волки']);
  assert.equal((await as('bob')('PATCH', `/api/clans/${id}`, { tag: 'brv' })).json.error, 'tag_taken');
  assert.equal((await as('bob')('PATCH', `/api/clans/${id}`, {})).status, 400);
  assert.equal((await as('dave')('PATCH', `/api/clans/${id}`, { name: 'Hijack' })).status, 404);
  const a = await as('admin')('PATCH', `/api/clans/${id}`, { name: 'Renamed by admin' });
  assert.equal(a.status, 200);
  assert.equal(a.json.clan, null, 'the admin is not a member, so their own body has no clan');
  assert.equal((await as('alice')('GET', '/api/my/clan')).json.clan.name, 'Renamed by admin');
});

test('deleting a clan: owner or site admin', async (t) => {
  const { s, as, makeClan, addMember } = await clanSetup(t);
  const id = await makeClan();
  addMember(id, 'bob');
  assert.equal((await as('bob')('DELETE', `/api/clans/${id}`)).status, 403);
  const r = await as('alice')('DELETE', `/api/clans/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.clan, null);
  assert.equal(count(s, 'SELECT COUNT(*) AS n FROM clan_members'), 0);
  const id2 = await makeClan('carol', 'BRV', 'Bravo team');
  assert.equal((await as('admin')('DELETE', `/api/clans/${id2}`)).status, 200);
  assert.deepEqual((await s.api('GET', '/api/clans')).json, []);
});

test('the site admin blocks and unblocks clan creation', async (t) => {
  const { as, users } = await clanSetup(t);
  assert.equal((await as('alice')('POST', `/api/users/${users.bob.id}/block-clans`, { blocked: true })).status, 403);
  assert.equal((await as('admin')('POST', `/api/users/${users.admin.id}/block-clans`, { blocked: true })).status, 400);
  assert.equal((await as('admin')('POST', `/api/users/${users.bob.id}/block-clans`, { blocked: 'yes' })).status, 400);
  assert.equal((await as('admin')('POST', '/api/users/999/block-clans', { blocked: true })).status, 404);
  assert.equal((await as('admin')('POST', `/api/users/${users.bob.id}/block-clans`, { blocked: true })).status, 200);
  assert.equal((await as('bob')('POST', '/api/clans', { tag: 'BOB', name: 'Bob clan' })).json.error, 'clans_blocked');
  await as('admin')('POST', `/api/users/${users.bob.id}/block-clans`, { blocked: false });
  assert.equal((await as('bob')('POST', '/api/clans', { tag: 'BOB', name: 'Bob clan' })).status, 201);
});
