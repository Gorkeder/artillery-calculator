'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, MIGRATIONS, migrate } = require('../db');
const { clanSetup } = require('./clan-helpers');
const repo = require('../repo');

test('migration 7 adds tactic tables on top of version 6 and keeps data', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const m of MIGRATIONS.filter((x) => x.version <= 6)) db.exec(m.sql);
  db.exec('PRAGMA user_version = 6');
  db.exec("INSERT INTO users (login, password_hash, role) VALUES ('keeper', 'x', 'user')");
  migrate(db);
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tactic_plans').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tactic_items').get().n, 0);
  db.close();
});

test('deleting a clan, a map or a squad cascades as the spec says', async (t) => {
  const { s, makeClan } = await clanSetup(t);
  const clanId = await makeClan();
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const squadId = Number(s.db.prepare("INSERT INTO clan_squads (clan_id, name, color) VALUES (?, 'A', '#ff0000')").run(clanId).lastInsertRowid);
  const planId = Number(s.db.prepare(
    "INSERT INTO tactic_plans (public_id, clan_id, map_id, title) VALUES ('abcdefghijkl', ?, ?, 'P')",
  ).run(clanId, mapId).lastInsertRowid);
  s.db.prepare(
    "INSERT INTO tactic_items (plan_id, squad_id, kind, geometry) VALUES (?, ?, 'pencil', '[[0,0],[1,1]]')",
  ).run(planId, squadId);
  s.db.prepare('DELETE FROM clan_squads WHERE id = ?').run(squadId);
  assert.equal(s.db.prepare('SELECT squad_id FROM tactic_items').get().squad_id, null, 'squad delete → общий рисунок');
  s.db.prepare('DELETE FROM clans WHERE id = ?').run(clanId);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tactic_plans').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tactic_items').get().n, 0);
});

test('only one active plan per clan and map is allowed by the schema', async (t) => {
  const { s, makeClan } = await clanSetup(t);
  const clanId = await makeClan();
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const ins = s.db.prepare(
    'INSERT INTO tactic_plans (public_id, clan_id, map_id, title, is_active) VALUES (?, ?, ?, ?, 1)',
  );
  ins.run('aaaaaaaaaaaa', clanId, mapId, 'One');
  assert.throws(() => ins.run('bbbbbbbbbbbb', clanId, mapId, 'Two'), /UNIQUE/);
});

const { PERMS } = require('../clan-permissions');

// A clan with owner alice, members bob (no rights), carol (full tactics), published map "main".
async function tacticSetup(t) {
  const x = await clanSetup(t);
  const clanId = await x.makeClan();
  for (const who of ['bob', 'carol', 'dave']) x.addMember(clanId, who);
  const mapId = repo.insertRow(x.s.db, 'maps', { slug: 'main', title: 'Main', published: 1, width: 100, height: 100 });
  const draftId = repo.insertRow(x.s.db, 'maps', { slug: 'draft', title: 'Draft', published: 0 });
  x.grantRole(clanId, 'carol', 'Planner', 5, PERMS.tactics_view | PERMS.tactics_draw | PERMS.plans_manage, 1);
  return { ...x, clanId, mapId, draftId, base: `/api/clans/${clanId}` };
}

test('creating a plan needs plans_manage and a published map; the first plan of a map becomes active', async (t) => {
  const { as, base, mapId, draftId } = await tacticSetup(t);
  assert.equal((await as('bob')('POST', base + '/plans', { mapId, title: 'X' })).status, 403);
  assert.equal((await as('carol')('POST', base + '/plans', { mapId: draftId, title: 'X' })).status, 404);
  assert.equal((await as('carol')('POST', base + '/plans', { mapId, title: '' })).status, 400);
  const r = await as('carol')('POST', base + '/plans', { mapId, title: 'Штурм' });
  assert.equal(r.status, 201);
  assert.equal(r.json.plan.active, true);
  assert.match(r.json.plan.id, /^[0-9A-Za-z]{12}$/);
  const r2 = await as('carol')('POST', base + '/plans', { mapId, title: 'Запасной' });
  assert.equal(r2.json.plan.active, false);
});

test('plan routes reject a non-object body', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  assert.equal((await as('carol')('POST', base + '/plans', [1, 2])).status, 400);
  assert.equal((await as('carol')('POST', base + '/plans', null)).status, 400);
  const pid = (await as('carol')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  assert.equal((await as('carol')('PATCH', '/api/plans/' + pid, [1])).status, 400);
  assert.equal((await as('carol')('PATCH', '/api/plans/' + pid, {})).status, 400);
});

test('plan limit is 25 per clan', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  for (let i = 0; i < 25; i++) {
    assert.equal((await as('alice')('POST', base + '/plans', { mapId, title: 'P' + i })).status, 201);
  }
  const r = await as('alice')('POST', base + '/plans', { mapId, title: 'P25' });
  assert.deepEqual([r.status, r.json.error], [409, 'plans_limit']);
});

test('list: members with tactics_view see plans; strangers get 404; map filter works', async (t) => {
  const { as, base, mapId, clanId, s } = await tacticSetup(t);
  const other = repo.insertRow(s.db, 'maps', { slug: 'north', title: 'North', published: 1 });
  await as('alice')('POST', base + '/plans', { mapId, title: 'A' });
  await as('alice')('POST', base + '/plans', { mapId: other, title: 'B' });
  const all = await as('bob')('GET', base + '/plans');
  assert.equal(all.status, 200);
  assert.equal(all.json.length, 2);
  const one = await as('bob')('GET', base + '/plans?map=north');
  assert.deepEqual(one.json.map((p) => p.title), ['B']);
  assert.equal((await as('bob')('GET', `/api/clans/${clanId + 1}/plans`)).status, 404);
  assert.equal((await as('bob')('GET', base + '/plans?map=nope')).status, 404);
  // a viewer role without tactics_view
  s.db.prepare('UPDATE clan_roles SET perms = 0 WHERE clan_id = ? AND is_everyone = 1').run(clanId);
  assert.equal((await as('bob')('GET', base + '/plans')).status, 403);
});

test('GET plan sends ETag and answers 304 on a match; a stranger or a guest cannot read it', async (t) => {
  const { as, base, mapId, s } = await tacticSetup(t);
  const created = await as('alice')('POST', base + '/plans', { mapId, title: 'A' });
  const pid = created.json.plan.id;
  const first = await as('bob')('GET', '/api/plans/' + pid);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.equal(etag, `"v${first.json.plan.version}"`);
  const again = await as('bob')('GET', '/api/plans/' + pid, undefined, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.json, null);
  assert.equal(again.headers.get('etag'), etag);
  const stale = await as('bob')('GET', '/api/plans/' + pid, undefined, { headers: { 'if-none-match': '"v0"' } });
  assert.equal(stale.status, 200);
  assert.equal((await s.api('GET', '/api/plans/' + pid)).status, 401);
  // a member of nobody
  const eve = require('../auth').createUser(s.db, { login: 'eve', password: 'eve-pass-123', role: 'user' });
  const evec = 'sid=' + require('../auth').createSession(s.db, eve, Date.now());
  assert.equal((await s.api('GET', '/api/plans/' + pid, { cookie: evec })).status, 404);
  assert.equal((await as('bob')('GET', '/api/plans/zzzzzzzzzzzz')).status, 404);
});

test('304 does not load the items (one plan lookup and the membership check)', async (t) => {
  const { as, base, mapId, s } = await tacticSetup(t);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  const etag = '"v1"';
  const calls = [];
  const orig = s.db.prepare.bind(s.db);
  s.db.prepare = (sql) => { calls.push(sql); return orig(sql); };
  const r = await as('bob')('GET', '/api/plans/' + pid, undefined, { headers: { 'if-none-match': etag } });
  s.db.prepare = orig;
  assert.equal(r.status, 304);
  assert.equal(calls.some((q) => /FROM tactic_items/.test(q)), false);
});

test('rename and activate need plans_manage; activation moves the star and bumps both versions', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  const a = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan;
  const b = (await as('alice')('POST', base + '/plans', { mapId, title: 'B' })).json.plan;
  assert.equal((await as('bob')('PATCH', '/api/plans/' + b.id, { title: 'Z' })).status, 403);
  const ren = await as('carol')('PATCH', '/api/plans/' + b.id, { title: 'Новый' });
  assert.equal(ren.json.plan.title, 'Новый');
  assert.ok(ren.json.plan.version > b.version);
  assert.equal((await as('bob')('POST', `/api/plans/${b.id}/activate`)).status, 403);
  const act = await as('carol')('POST', `/api/plans/${b.id}/activate`);
  assert.equal(act.json.plan.active, true);
  const old = await as('carol')('GET', '/api/plans/' + a.id);
  assert.equal(old.json.plan.active, false);
  assert.ok(old.json.plan.version > a.version, 'the old active plan is refreshed too');
});

test('a member who is kicked or loses tactics_view gets 404/403 on the next read', async (t) => {
  const { as, base, mapId, clanId, s, users } = await tacticSetup(t);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  assert.equal((await as('bob')('GET', '/api/plans/' + pid)).status, 200);
  s.db.prepare('UPDATE clan_roles SET perms = 0 WHERE clan_id = ? AND is_everyone = 1').run(clanId);
  assert.equal((await as('bob')('GET', '/api/plans/' + pid)).status, 403);
  s.db.prepare('DELETE FROM clan_members WHERE user_id = ?').run(users.bob.id);
  assert.equal((await as('bob')('GET', '/api/plans/' + pid)).status, 404);
});

test('the site admin reads any clan plans but cannot create or change them', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  assert.equal((await as('admin')('GET', base + '/plans')).status, 200);
  assert.equal((await as('admin')('GET', '/api/plans/' + pid)).status, 200);
  assert.equal((await as('admin')('POST', base + '/plans', { mapId, title: 'X' })).status, 404);
  assert.equal((await as('admin')('PATCH', '/api/plans/' + pid, { title: 'X' })).status, 403);
  assert.equal((await as('admin')('POST', `/api/plans/${pid}/activate`)).status, 403);
});

test('If-None-Match accepts weak validators and lists; an unpublished map slug is 404 in the list', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  const plan = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan;
  const etag = `"v${plan.version}"`;
  const get = (inm) => as('bob')('GET', '/api/plans/' + plan.id, undefined, { headers: { 'if-none-match': inm } });
  assert.equal((await get('W/' + etag)).status, 304);
  assert.equal((await get(`"v0", ${etag}`)).status, 304);
  assert.equal((await get('*')).status, 304);
  assert.equal((await get('"v0", W/"v99"')).status, 200);
  assert.equal((await as('bob')('GET', base + '/plans?map=draft')).status, 404);
});

const PENCIL = [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]];

async function withSquads(t) {
  const x = await tacticSetup(t);
  const { s, clanId, as, base, mapId } = x;
  const sq = (name) => Number(s.db.prepare(
    "INSERT INTO clan_squads (clan_id, name, color) VALUES (?, ?, '#ff0000')",
  ).run(clanId, name).lastInsertRowid);
  const alpha = sq('Alpha');
  const bravo = sq('Bravo');
  // bob commands Alpha only
  const role = x.grantRole(clanId, 'bob', 'AlphaCmd', 3, PERMS.tactics_view | PERMS.tactics_draw, 0);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(role, alpha);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'Plan' })).json.plan.id;
  return { ...x, alpha, bravo, pid };
}

test('drawing for a squad needs tactics_draw and that squad; общий рисунок needs "all squads"', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  const ok1 = await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha });
  assert.equal(ok1.status, 201);
  assert.equal(ok1.json.item.squad_id, alpha);
  assert.equal(ok1.json.item.author_id !== null, true);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: bravo })).status, 403);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 403, 'общий');
  assert.equal((await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 201, 'all squads');
  assert.equal((await as('dave')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 403, 'no tactics_draw');
});

test('a foreign or missing squad id is rejected', async (t) => {
  const { as, pid, s } = await withSquads(t);
  const other = Number(s.db.prepare("INSERT INTO clans (tag, tag_key, name, name_key, owner_id) VALUES ('ZZ','zz','Other','other',?)")
    .run(s.adminId).lastInsertRowid);
  const foreign = Number(s.db.prepare("INSERT INTO clan_squads (clan_id, name, color) VALUES (?, 'X', '#000000')").run(other).lastInsertRowid);
  const r = await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: foreign });
  assert.equal(r.status, 404);
  assert.equal((await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: 99999 })).status, 404);
});

test('every change bumps the version; parallel strokes are all kept', async (t) => {
  const { as, pid, alpha } = await withSquads(t);
  const v0 = (await as('alice')('GET', '/api/plans/' + pid)).json.plan.version;
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha, width: (i % 3) + 1 })));
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201, 201]);
  const body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(body.items.length, 6);
  assert.equal(body.plan.version, v0 + 6);
  assert.equal(new Set(results.map((r) => r.json.version)).size, 6, 'each response carries its own version');
});

test('500 drawings per plan', async (t) => {
  const { as, pid, s } = await withSquads(t);
  const planId = s.db.prepare('SELECT id FROM tactic_plans WHERE public_id = ?').get(pid).id;
  const ins = s.db.prepare("INSERT INTO tactic_items (plan_id, kind, geometry) VALUES (?, 'pencil', '[[0,0],[1,1]]')");
  for (let i = 0; i < 500; i++) ins.run(planId);
  const r = await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL });
  assert.deepEqual([r.status, r.json.error], [409, 'items_limit']);
});

test('bad strokes give 400 and write nothing', async (t) => {
  const { as, pid, s } = await withSquads(t);
  for (const geometry of [[], [[0.1, 0.1]], [[0.1, 2], [0.2, 0.2]], 'x']) {
    assert.equal((await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry })).status, 400);
  }
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tactic_items').get().n, 0);
  assert.equal((await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: Array.from({ length: 2001 }, () => [0.5, 0.5]) })).status, 400);
});

test('the eraser: a squad commander removes only their squad, the author can always remove their own', async (t) => {
  const { as, pid, alpha, bravo, s, clanId, users } = await withSquads(t);
  const a = (await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  const b = (await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: bravo })).json.item;
  const g = (await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  assert.equal((await as('bob')('DELETE', '/api/items/' + b.id)).status, 403);
  assert.equal((await as('bob')('DELETE', '/api/items/' + g.id)).status, 403);
  const del = await as('bob')('DELETE', '/api/items/' + a.id);
  assert.equal(del.status, 200);
  assert.equal(typeof del.json.version, 'number');
  // own drawing survives losing tactics_draw
  const mine = (await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  s.db.prepare('DELETE FROM clan_member_roles WHERE user_id = ?').run(users.bob.id);
  assert.equal((await as('bob')('DELETE', '/api/items/' + mine.id)).status, 200);
  assert.equal(clanId > 0, true);
});

test('PATCH moves a stroke only when both squads are allowed; geometry is revalidated', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  const it = (await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  assert.equal((await as('bob')('PATCH', '/api/items/' + it.id, { squad: bravo })).status, 403);
  assert.equal((await as('bob')('PATCH', '/api/items/' + it.id, { geometry: [[0, 0]] })).status, 400);
  const r = await as('bob')('PATCH', '/api/items/' + it.id, { width: 3, geometry: [[0.5, 0.5], [0.6, 0.6]] });
  assert.equal(r.status, 200);
  assert.equal(r.json.item.width, 3);
  assert.deepEqual(r.json.item.geometry, [[0.5, 0.5], [0.6, 0.6]]);
});

test('another clan cannot touch items: 404', async (t) => {
  const { as, pid, s } = await withSquads(t);
  const it = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  const { createUser, createSession } = require('../auth');
  const eve = createUser(s.db, { login: 'eve', password: 'eve-pass-123', role: 'user' });
  const cookie = 'sid=' + createSession(s.db, eve, Date.now());
  assert.equal((await s.api('DELETE', '/api/items/' + it.id, { cookie })).status, 404);
  assert.equal((await s.api('POST', `/api/plans/${pid}/items`, { cookie, body: { kind: 'pencil', geometry: PENCIL } })).status, 404);
});

test('clear: whole plan needs plans_manage, one squad needs plans_manage or drawing for that squad', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  for (const sq of [alpha, bravo, alpha]) {
    await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: sq });
  }
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/clear`)).status, 403);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/clear?squad=${bravo}`)).status, 403);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/clear?squad=${alpha}`)).status, 200);
  let body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(body.items.length, 1);
  assert.equal((await as('carol')('POST', `/api/plans/${pid}/clear`)).status, 200);
  body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(body.items.length, 0);
});

test('delete plan: plans_manage or the site admin; drawings go with it; active slot is free again', async (t) => {
  const { as, pid, base, mapId } = await withSquads(t);
  await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL });
  assert.equal((await as('dave')('DELETE', '/api/plans/' + pid)).status, 403);
  assert.equal((await as('admin')('DELETE', '/api/plans/' + pid)).status, 200);
  assert.equal((await as('alice')('GET', '/api/plans/' + pid)).status, 404);
  const fresh = await as('alice')('POST', base + '/plans', { mapId, title: 'Again' });
  assert.equal(fresh.json.plan.active, true);
});

test('the site admin may delete a drawing but not create one', async (t) => {
  const { as, pid } = await withSquads(t);
  const it = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  assert.equal((await as('admin')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 403);
  assert.equal((await as('admin')('DELETE', '/api/items/' + it.id)).status, 200);
});

test('write limit: 61st edit within a minute gets 429', async (t) => {
  const { as, pid } = await withSquads(t);
  let last = 0;
  for (let i = 0; i < 61; i++) {
    last = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status;
    if (last === 429) break;
  }
  assert.equal(last, 429);
});

test('two sequential writes grow the version by exactly 2', async (t) => {
  const { as, pid } = await withSquads(t);
  const v0 = (await as('alice')('GET', '/api/plans/' + pid)).json.plan.version;
  const a = await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL });
  const b = await as('alice')('PATCH', '/api/items/' + a.json.item.id, { width: 1 });
  assert.equal(b.json.version, v0 + 2);
  assert.equal((await as('alice')('GET', '/api/plans/' + pid)).json.plan.version, v0 + 2);
});

test('PATCH ignores a client __kind and rejects non-object bodies and kind changes', async (t) => {
  const { as, pid } = await withSquads(t);
  const it = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  assert.equal((await as('alice')('PATCH', '/api/items/' + it.id, [1])).status, 400);
  assert.equal((await as('alice')('PATCH', '/api/items/' + it.id, null)).status, 400);
  assert.equal((await as('alice')('PATCH', '/api/items/' + it.id, { kind: 'arrow' })).status, 400);
  assert.equal((await as('alice')('PATCH', '/api/items/' + it.id, { __kind: 'bogus', geometry: [[0.1, 0.1], [0.2, 0.2]] })).status, 200);
  assert.equal((await as('alice')('PATCH', '/api/items/' + it.id, {})).status, 400);
});

