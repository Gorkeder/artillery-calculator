'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clanSetup } = require('./clan-helpers');
const { createUser, createSession } = require('../auth');

test('creating a clan makes the creator its owner with an @everyone role', async (t) => {
  const { as, users } = await clanSetup(t);
  const r = await as('alice')('POST', '/api/clans', { tag: 'ALF', name: 'Alpha Wolves', description: 'hi' });
  assert.equal(r.status, 201);
  assert.equal(r.json.clan.tag, 'ALF');
  assert.equal(r.json.clan.description, 'hi');
  assert.equal(r.json.me.isOwner, true);
  assert.equal(r.json.me.top, null);
  assert.equal(r.json.me.drawSquads, 'all');
  assert.equal(r.json.me.perms.length, 8);
  assert.deepEqual(r.json.members.map((m) => [m.id, m.owner]), [[users.alice.id, true]]);
  assert.deepEqual(r.json.roles.map((x) => [x.name, x.everyone, x.perms]), [['@everyone', true, ['tactics_view']]]);
  assert.deepEqual(r.json.limits, { members: 50, squads: 10, roles: 10, activeInvites: 20, pendingInvitations: 50 });
  const me = await as('alice')('GET', '/api/me');
  assert.deepEqual(me.json.user.clan, { id: r.json.clan.id, tag: 'ALF' });
  assert.equal(me.json.user.clanInvitations, 0);
});

test('clan creation needs a signed-in, verified, unblocked user outside any clan', async (t) => {
  const { s, as, users } = await clanSetup(t);
  assert.equal((await s.api('POST', '/api/clans', { body: { tag: 'ALF', name: 'Alpha' } })).status, 401);
  const eve = createUser(s.db, { login: 'eve', password: 'eve-pass-12', role: 'user', email: 'eve@example.com', emailVerified: false });
  const eveCookie = 'sid=' + createSession(s.db, eve, Date.now());
  const r1 = await s.api('POST', '/api/clans', { cookie: eveCookie, body: { tag: 'EVE', name: 'Eve clan' } });
  assert.deepEqual([r1.status, r1.json.error], [403, 'email_not_verified']);
  s.db.prepare('UPDATE users SET clans_blocked = 1 WHERE id = ?').run(users.bob.id);
  const r2 = await as('bob')('POST', '/api/clans', { tag: 'BOB', name: 'Bob clan' });
  assert.deepEqual([r2.status, r2.json.error], [403, 'clans_blocked']);
  assert.equal((await as('alice')('POST', '/api/clans', { tag: 'ALF', name: 'Alpha' })).status, 201);
  const r3 = await as('alice')('POST', '/api/clans', { tag: 'ALF2', name: 'Alpha two' });
  assert.deepEqual([r3.status, r3.json.error], [409, 'already_in_clan']);
});

test('parallel creates by one user give exactly one clan and no 500', async (t) => {
  const { s, as } = await clanSetup(t);
  const results = await Promise.all([
    as('alice')('POST', '/api/clans', { tag: 'AA', name: 'First clan' }),
    as('alice')('POST', '/api/clans', { tag: 'BB', name: 'Second clan' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM clans').get().n, 1);
});

test('tags and names are unique ignoring case and ё; bad input is rejected', async (t) => {
  const { as } = await clanSetup(t);
  assert.equal((await as('alice')('POST', '/api/clans', { tag: 'ALF', name: 'Ёжики' })).status, 201);
  const r1 = await as('bob')('POST', '/api/clans', { tag: 'alf', name: 'Other' });
  assert.deepEqual([r1.status, r1.json.error], [409, 'tag_taken']);
  const r2 = await as('bob')('POST', '/api/clans', { tag: 'BRV', name: 'ежики' });
  assert.deepEqual([r2.status, r2.json.error], [409, 'name_taken']);
  const r3 = await as('bob')('POST', '/api/clans', { tag: 'A', name: 'Bravo' });
  assert.deepEqual([r3.status, r3.json.error], [400, 'tag_invalid']);
});

test('catalog and profile are public; profile finds Cyrillic tags in any case', async (t) => {
  const { s, makeClan, addMember, grantRole } = await clanSetup(t);
  const id = await makeClan('alice', 'ВОЛ', 'Серые волки');
  addMember(id, 'bob');
  grantRole(id, 'bob', 'Офицер', 1, 32);
  await makeClan('carol', 'BRV', 'Bravo team');
  const all = await s.api('GET', '/api/clans');
  assert.equal(all.status, 200);
  assert.deepEqual(all.json.map((c) => [c.tag, c.members]), [['ВОЛ', 2], ['BRV', 1]]);
  assert.deepEqual((await s.api('GET', '/api/clans?q=' + encodeURIComponent('ВОЛК'))).json.map((c) => c.tag), ['ВОЛ']);
  assert.deepEqual((await s.api('GET', '/api/clans?q=%25')).json, [], 'LIKE wildcards are escaped');
  const p = await s.api('GET', '/api/clans/' + encodeURIComponent('вол'));
  assert.equal(p.status, 200);
  assert.equal(p.json.owner, 'alice');
  assert.deepEqual(p.json.members, [
    { login: 'alice', owner: true, roles: [] },
    { login: 'bob', owner: false, roles: [{ name: 'Офицер', color: '#9a9a86' }] },
  ]);
  assert.equal((await s.api('GET', '/api/clans/NOPE')).status, 404);
});

test('GET /api/my/clan: 401 for guests, invitations for outsiders, full body for members', async (t) => {
  const { s, as, users, makeClan, addMember } = await clanSetup(t);
  assert.equal((await s.api('GET', '/api/my/clan')).status, 401);
  const id = await makeClan();
  s.db.prepare('INSERT INTO clan_invitations (clan_id, user_id, invited_by) VALUES (?, ?, ?)').run(id, users.carol.id, users.alice.id);
  const out = await as('carol')('GET', '/api/my/clan');
  assert.equal(out.json.clan, null);
  assert.deepEqual(out.json.invitations.map((i) => [i.tag, i.invited_by]), [['ALF', 'alice']]);
  assert.equal((await as('carol')('GET', '/api/me')).json.user.clanInvitations, 1);
  addMember(id, 'bob');
  const mine = await as('bob')('GET', '/api/my/clan');
  assert.equal(mine.json.clan.id, id);
  assert.deepEqual(mine.json.me, { id: users.bob.id, isOwner: false, perms: ['tactics_view'], top: 0, drawSquads: [] });
});
