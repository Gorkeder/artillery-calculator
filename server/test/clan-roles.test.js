'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clanSetup } = require('./clan-helpers');
const { PERMS } = require('../clan-permissions');

async function setup(t) {
  const x = await clanSetup(t);
  const id = await x.makeClan();
  for (const who of ['bob', 'carol', 'dave']) x.addMember(id, who);
  return { ...x, id, base: `/api/clans/${id}` };
}

test('the owner creates roles; new roles go right above @everyone', async (t) => {
  const { as, base } = await setup(t);
  const r1 = await as('alice')('POST', base + '/roles', { name: 'Officer', color: '#ff0000', perms: ['kick', 'invite'] });
  assert.equal(r1.status, 201);
  const r2 = await as('alice')('POST', base + '/roles', { name: 'Recruit' });
  assert.deepEqual(r2.json.roles.map((r) => [r.name, r.position]), [['Officer', 2], ['Recruit', 1], ['@everyone', 0]]);
  assert.deepEqual(r2.json.roles[0].perms, ['invite', 'kick']);
  assert.equal((await as('bob')('POST', base + '/roles', { name: 'Nope' })).status, 403, 'no roles_manage');
});

test('role limit is 10 not counting @everyone', async (t) => {
  const { as, base } = await setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await as('alice')('POST', base + '/roles', { name: 'R' + i })).status, 201);
  const r = await as('alice')('POST', base + '/roles', { name: 'R10' });
  assert.deepEqual([r.status, r.json.error], [409, 'roles_limit']);
});

test('an officer cannot grant flags they lack, touch roles at or above theirs, or self-promote', async (t) => {
  const { as, base, id, users, grantRole } = await setup(t);
  const officer = grantRole(id, 'bob', 'Officer', 5, PERMS.roles_manage | PERMS.kick);
  const peer = grantRole(id, null, 'Peer', 5, PERMS.invite);
  const low = (await as('bob')('POST', base + '/roles', { name: 'Low', perms: ['kick'] }));
  assert.equal(low.status, 201);
  const lowId = low.json.roles.find((r) => r.name === 'Low').id;
  const bad = await as('bob')('POST', base + '/roles', { name: 'Bad', perms: ['invite'] });
  assert.deepEqual([bad.status, bad.json.error], [403, 'perm_not_held']);
  assert.equal((await as('bob')('PATCH', `${base}/roles/${officer}`, { name: 'Boss' })).json.error, 'role_above', 'own role');
  assert.equal((await as('bob')('PATCH', `${base}/roles/${peer}`, { name: 'X' })).json.error, 'role_above', 'equal role');
  assert.equal((await as('bob')('PATCH', `${base}/roles/${lowId}`, { perms: ['kick', 'clan_settings'] })).json.error, 'perm_not_held');
  assert.equal((await as('bob')('PATCH', `${base}/roles/${lowId}`, { name: 'Lower' })).status, 200);
  const give = await as('bob')('PUT', `${base}/members/${users.bob.id}`, { roles: [officer, peer] });
  assert.equal(give.status, 403, 'cannot give self an equal role');
  assert.equal((await as('bob')('PUT', `${base}/members/${users.carol.id}`, { roles: [lowId] })).status, 200);
  assert.equal((await as('bob')('PUT', `${base}/members/${users.alice.id}`, { roles: [lowId] })).status, 403, 'owner');
  assert.equal((await as('bob')('DELETE', `${base}/roles/${peer}`)).status, 403);
  assert.equal((await as('bob')('DELETE', `${base}/roles/${lowId}`)).status, 200);
});

test('@everyone keeps its name and cannot be deleted or assigned', async (t) => {
  const { as, base, users } = await setup(t);
  const body = (await as('alice')('GET', '/api/my/clan')).json;
  const everyone = body.roles.find((r) => r.everyone).id;
  assert.equal((await as('alice')('PATCH', `${base}/roles/${everyone}`, { name: 'all' })).json.error, 'everyone_name_fixed');
  const p = await as('alice')('PATCH', `${base}/roles/${everyone}`, { perms: ['tactics_view', 'invite'] });
  assert.deepEqual(p.json.roles.find((r) => r.everyone).perms, ['tactics_view', 'invite']);
  assert.deepEqual((await as('bob')('GET', '/api/my/clan')).json.me.perms, ['tactics_view', 'invite']);
  assert.equal((await as('alice')('DELETE', `${base}/roles/${everyone}`)).json.error, 'everyone_fixed');
  assert.equal((await as('alice')('PUT', `${base}/members/${users.bob.id}`, { roles: [everyone] })).status, 400);
});

test('role order: only roles below yours, permuted within their positions', async (t) => {
  const { as, base, id, grantRole } = await setup(t);
  grantRole(id, 'bob', 'Officer', 3, PERMS.roles_manage);
  const a = grantRole(id, null, 'A', 2, 0);
  const b = grantRole(id, null, 'B', 1, 0);
  const r = await as('bob')('PUT', base + '/roles/order', { ids: [b, a] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.roles.map((x) => x.name), ['Officer', 'B', 'A', '@everyone']);
  const bad = await as('bob')('PUT', base + '/roles/order', { ids: [b] });
  assert.deepEqual([bad.status, bad.json.error], [400, 'order_mismatch']);
});

test('draw scope: limited commanders grant only their squads', async (t) => {
  const { s, as, base, id, grantRole } = await setup(t);
  const alpha = (await as('alice')('POST', base + '/squads', { name: 'Alpha' })).json.squads[0].id;
  const bravo = (await as('alice')('POST', base + '/squads', { name: 'Bravo' })).json.squads[1].id;
  const cmd = grantRole(id, 'bob', 'Alpha cmd', 5, PERMS.roles_manage | PERMS.tactics_draw);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(cmd, alpha);
  const ok = await as('bob')('POST', base + '/roles', { name: 'Alpha 2', perms: ['tactics_draw'], squads: [alpha] });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.roles.find((r) => r.name === 'Alpha 2').squads, [alpha]);
  assert.equal((await as('bob')('POST', base + '/roles', { name: 'B', perms: ['tactics_draw'], squads: [bravo] })).json.error, 'squad_not_held');
  assert.equal((await as('bob')('POST', base + '/roles', { name: 'All', perms: ['tactics_draw'], draw_all_squads: true })).json.error, 'squad_not_held');
  assert.equal((await as('alice')('POST', base + '/roles', { name: 'X', squads: [9999] })).json.error, 'unknown squad');
  const all = await as('alice')('POST', base + '/roles', { name: 'All', perms: ['tactics_draw'], draw_all_squads: true });
  const allRole = all.json.roles.find((r) => r.name === 'All');
  assert.equal(allRole.draw_all_squads, true);
  assert.equal((await as('bob')('PATCH', `${base}/roles/${allRole.id}`, { name: 'All squads', draw_all_squads: true })).status, 200,
    'an unchanged draw scope is not re-checked');
});

test('squads: create with default colors, limit, rename, order, delete', async (t) => {
  const { as, base } = await setup(t);
  assert.equal((await as('bob')('POST', base + '/squads', { name: 'A' })).status, 403);
  let last;
  for (let i = 0; i < 10; i++) last = await as('alice')('POST', base + '/squads', { name: 'S' + i });
  assert.equal(last.status, 201);
  assert.equal(new Set(last.json.squads.map((x) => x.color)).size, 10, 'palette gives distinct colors');
  assert.equal((await as('alice')('POST', base + '/squads', { name: 'S10' })).json.error, 'squads_limit');
  const ids = last.json.squads.map((x) => x.id);
  const renamed = await as('alice')('PATCH', `${base}/squads/${ids[0]}`, { name: 'Альфа', color: '#123456' });
  assert.deepEqual([renamed.json.squads[0].name, renamed.json.squads[0].color], ['Альфа', '#123456']);
  const order = await as('alice')('PUT', base + '/squads/order', { ids: ids.slice().reverse() });
  assert.equal(order.json.squads[0].id, ids[9]);
  assert.equal((await as('alice')('PUT', base + '/squads/order', { ids: ids.slice(1) })).json.error, 'order_mismatch');
  const del = await as('alice')('DELETE', `${base}/squads/${ids[0]}`);
  assert.equal(del.json.squads.length, 9);
});

test('members can be in several squads; squads_manage may place lower members and self', async (t) => {
  const { as, base, id, users, grantRole } = await setup(t);
  const a = (await as('alice')('POST', base + '/squads', { name: 'A' })).json.squads[0].id;
  const b = (await as('alice')('POST', base + '/squads', { name: 'B' })).json.squads[1].id;
  grantRole(id, 'bob', 'Sergeant', 2, PERMS.squads_manage);
  grantRole(id, 'dave', 'Sergeant 2', 2, 0);
  const r = await as('bob')('PUT', `${base}/members/${users.carol.id}`, { squads: [a, b] });
  assert.deepEqual(r.json.members.find((m) => m.login === 'carol').squads.sort(), [a, b].sort());
  assert.equal((await as('bob')('PUT', `${base}/members/${users.bob.id}`, { squads: [a] })).status, 200, 'self');
  assert.equal((await as('bob')('PUT', `${base}/members/${users.dave.id}`, { squads: [a] })).status, 403, 'equal rank');
  assert.equal((await as('carol')('PUT', `${base}/members/${users.carol.id}`, { squads: [] })).status, 403, 'no flag');
  assert.equal((await as('bob')('PUT', `${base}/members/${users.carol.id}`, { squads: [9999] })).json.error, 'unknown squad');
  assert.equal((await as('bob')('PUT', `${base}/members/${users.carol.id}`, {})).status, 400);
});

test('assigning a role cannot widen draw rights beyond the assigner scope', async (t) => {
  const { s, as, base, id, users, grantRole } = await setup(t);
  const alpha = (await as('alice')('POST', base + '/squads', { name: 'Alpha' })).json.squads[0].id;
  const bravo = (await as('alice')('POST', base + '/squads', { name: 'Bravo' })).json.squads[1].id;
  const cmd = grantRole(id, 'bob', 'Alpha cmd', 5, PERMS.roles_manage | PERMS.tactics_draw);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(cmd, alpha);
  const wide = grantRole(id, null, 'Wide', 2, PERMS.tactics_draw, 1);
  const bravoRole = grantRole(id, null, 'Bravo draw', 2, PERMS.tactics_draw, 0);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(bravoRole, bravo);
  const alphaRole = grantRole(id, null, 'Alpha draw', 2, PERMS.tactics_draw, 0);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(alphaRole, alpha);
  const put = (uid, rid) => as('bob')('PUT', `${base}/members/${uid}`, { roles: [rid] });
  const w = await put(users.carol.id, wide);
  assert.deepEqual([w.status, w.json.error], [403, 'squad_not_held']);
  const b = await put(users.carol.id, bravoRole);
  assert.deepEqual([b.status, b.json.error], [403, 'squad_not_held']);
  assert.equal((await put(users.carol.id, alphaRole)).status, 200);
});

test('patching a role to gain tactics_draw re-checks its stored draw scope', async (t) => {
  const { s, as, base, id, grantRole } = await setup(t);
  const alpha = (await as('alice')('POST', base + '/squads', { name: 'Alpha' })).json.squads[0].id;
  const bravo = (await as('alice')('POST', base + '/squads', { name: 'Bravo' })).json.squads[1].id;
  const cmd = grantRole(id, 'bob', 'Alpha cmd', 5, PERMS.roles_manage | PERMS.tactics_draw);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(cmd, alpha);
  const wide = grantRole(id, null, 'Wide', 2, 0, 1);
  const br = grantRole(id, null, 'Bravo', 2, 0, 0);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(br, bravo);
  for (const rid of [wide, br]) {
    const r = await as('bob')('PATCH', `${base}/roles/${rid}`, { perms: ['tactics_draw'] });
    assert.deepEqual([r.status, r.json.error], [403, 'squad_not_held']);
  }
  assert.equal((await as('alice')('PATCH', `${base}/roles/${wide}`, { perms: ['tactics_draw'] })).status, 200);
  assert.equal((await as('alice')('PATCH', `${base}/roles/${br}`, { perms: ['tactics_draw'] })).status, 200);
});
