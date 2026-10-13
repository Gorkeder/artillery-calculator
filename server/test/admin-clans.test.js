'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clanSetup } = require('./clan-helpers');

async function setup(t) {
  const x = await clanSetup(t);
  const clanId = await x.makeClan();
  x.addMember(clanId, 'bob');
  x.s.db.prepare("INSERT INTO clan_squads (clan_id, name, color, position) VALUES (?, 'Alpha', '#ff0000', 0)").run(clanId);
  x.s.db.prepare('UPDATE users SET clans_blocked = 1 WHERE id = ?').run(x.users.bob.id);
  return { ...x, clanId };
}

test('guests get 401, players and clan owners get 403', async (t) => {
  const { s, as, clanId } = await setup(t);
  assert.equal((await s.api('GET', '/api/admin/clans')).status, 401);
  assert.equal((await as('alice')('GET', '/api/admin/clans')).status, 403, 'owner of a clan');
  assert.equal((await as('carol')('GET', '/api/admin/clans')).status, 403);
  assert.equal((await as('alice')('GET', `/api/admin/clans/${clanId}`)).status, 403);
});

test('the admin lists clans with counts and reads a clan with ids and block flags', async (t) => {
  const { as, clanId, users } = await setup(t);
  const list = await as('admin')('GET', '/api/admin/clans');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json, [{ id: clanId, tag: 'ALF', name: 'Alpha Wolves', members: 2, plans: 0 }]);
  const one = await as('admin')('GET', `/api/admin/clans/${clanId}`);
  assert.equal(one.status, 200);
  assert.equal(one.json.clan.tag, 'ALF');
  assert.deepEqual(one.json.squads.map((q) => q.name), ['Alpha']);
  const bob = one.json.members.find((m) => m.login === 'bob');
  assert.deepEqual([bob.id, bob.owner, bob.clans_blocked], [users.bob.id, false, true]);
  assert.equal(one.json.members.find((m) => m.login === 'alice').owner, true);
  assert.equal((await as('admin')('GET', `/api/admin/clans/${clanId + 5}`)).status, 404);
  assert.equal((await as('admin')('GET', '/api/admin/clans/abc')).status, 404);
});

test('the admin without a clan reads tactics, deletes a drawing, but cannot draw', async (t) => {
  const { as, clanId, s } = await setup(t);
  const mapId = Number(s.db.prepare("INSERT INTO maps (slug, title, published) VALUES ('main', 'Main', 1)").run().lastInsertRowid);
  const plan = (await as('alice')('POST', `/api/clans/${clanId}/plans`, { mapId, title: 'P' })).json.plan;
  const item = (await as('alice')('POST', `/api/plans/${plan.id}/items`,
    { kind: 'text', geometry: [0.5, 0.5], label: 'Привет' })).json.item;
  assert.equal((await as('admin')('GET', `/api/clans/${clanId}/plans`)).json.length, 1);
  assert.equal((await as('admin')('GET', `/api/plans/${plan.id}`)).json.items.length, 1);
  assert.equal((await as('admin')('POST', `/api/plans/${plan.id}/items`,
    { kind: 'text', geometry: [0.1, 0.1], label: 'x' })).status, 403);
  assert.equal((await as('admin')('DELETE', `/api/items/${item.id}`)).status, 200);
  assert.equal((await as('admin')('DELETE', `/api/plans/${plan.id}`)).status, 200);
});
