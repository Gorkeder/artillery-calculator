'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers');
const { openDb } = require('../db');
const { createRateLimiter, createUser, createSession } = require('../auth');
const repo = require('../repo');
const v = require('../validate');

const POINT = { map: 'main', shape: 'point', geometry: { x: 0.25, y: 0.75 }, title: 'Stash' };

async function setup(t, opts) {
  const s = await startTestServer(opts);
  t.after(() => s.cleanup());
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const draftId = repo.insertRow(s.db, 'maps', { slug: 'draft', title: 'Draft', published: 0 });
  const alice = createUser(s.db, { login: 'alice', password: 'alice-pass-1', role: 'user' });
  const bob = createUser(s.db, { login: 'bob', password: 'bob-pass-12', role: 'user' });
  const cookieFor = (id) => 'sid=' + createSession(s.db, id, Date.now());
  return { s, mapId, draftId, alice, bob, aliceCookie: cookieFor(alice), bobCookie: cookieFor(bob) };
}

// ---------- migration ----------

test('migration 3 creates user_marks and keeps existing data when upgrading from version 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-mig-'));
  const file = path.join(dir, 'a.db');
  try {
    let db = openDb(file);
    createUser(db, { login: 'keeper', password: 'keeper-pass-1', role: 'user' });
    db.exec('DROP TABLE user_marks');
    db.exec('PRAGMA user_version = 2');
    db.close();
    db = openDb(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE login = ?').get('keeper').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_marks').get().n, 0);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a user or a map deletes their marks', async (t) => {
  const { s, mapId, alice, bob } = await setup(t);
  const row = (userId) => ({ user_id: userId, map_id: mapId, shape: 'point', geometry: JSON.stringify({ x: 0, y: 0 }) });
  repo.insertRow(s.db, 'user_marks', row(alice));
  repo.insertRow(s.db, 'user_marks', row(bob));
  s.db.prepare('DELETE FROM users WHERE id = ?').run(alice);
  assert.equal(repo.countMarks(s.db, alice), 0);
  assert.equal(repo.countMarks(s.db, bob), 1);
  s.db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
  assert.equal(repo.countMarks(s.db, bob), 0);
});

// ---------- validation ----------

test('validateMark accepts good input and rejects bad fields', () => {
  assert.deepEqual(v.validateMark({ shape: 'point', title: 'T', color: '#aabbcc', icon: 'cache' }, { create: true }),
    { ok: true, value: { shape: 'point', title: 'T', color: '#aabbcc', icon: 'cache' } });
  assert.equal(v.validateMark({}, { create: true }).ok, false, 'shape is required on create');
  assert.equal(v.validateMark({ shape: 'circle' }, { create: true }).ok, false);
  assert.equal(v.validateMark({ title: 'x'.repeat(81) }).ok, false);
  assert.equal(v.validateMark({ title: 'x'.repeat(80) }).ok, true);
  assert.equal(v.validateMark({ description: 'x'.repeat(1001) }).ok, false);
  assert.equal(v.validateMark({ description: 'x'.repeat(1000) }).ok, true);
  assert.equal(v.validateMark({ color: 'red' }).ok, false);
  assert.equal(v.validateMark({ color: null }).ok, false, 'color is never null for a mark');
  assert.equal(v.validateMark({ icon: 'Bad Icon' }).ok, false);
  assert.deepEqual(v.validateMark({ shape: 'polygon', user_id: 5, id: 9 }), { ok: true, value: {} },
    'shape is ignored on update and unknown fields are dropped');
});

test('validateMarkGeometry limits vertices to 100', () => {
  const pts = (n) => ({ points: Array.from({ length: n }, (_, i) => [i / 200, 0.5]) });
  assert.equal(v.validateMarkGeometry('polygon', pts(100)).ok, true);
  assert.equal(v.validateMarkGeometry('polygon', pts(101)).ok, false);
  assert.equal(v.validateMarkGeometry('line', pts(2)).ok, true);
  assert.equal(v.validateMarkGeometry('line', pts(1)).ok, false);
  assert.equal(v.validateMarkGeometry('point', { x: 2, y: 0 }).ok, false);
});

// ---------- repo ----------

test('repo mark helpers return only the requested user and map and never expose user_id', async (t) => {
  const { s, mapId, alice, bob } = await setup(t);
  const other = repo.insertRow(s.db, 'maps', { slug: 'other', title: 'Other', published: 1 });
  const g = JSON.stringify({ x: 0.1, y: 0.2 });
  const a1 = repo.insertRow(s.db, 'user_marks', { user_id: alice, map_id: mapId, shape: 'point', geometry: g, title: 'a1' });
  repo.insertRow(s.db, 'user_marks', { user_id: alice, map_id: other, shape: 'point', geometry: g, title: 'a2' });
  repo.insertRow(s.db, 'user_marks', { user_id: bob, map_id: mapId, shape: 'point', geometry: g, title: 'b1' });
  const list = repo.listMarks(s.db, alice, mapId);
  assert.deepEqual(list.map((m) => m.title), ['a1']);
  assert.equal(list[0].map, 'main');
  assert.deepEqual(list[0].geometry, { x: 0.1, y: 0.2 });
  assert.equal('user_id' in list[0], false);
  assert.equal(repo.getMark(s.db, a1).title, 'a1');
  assert.equal(repo.getMarkRaw(s.db, a1).user_id, alice);
  assert.equal(repo.getMark(s.db, 99999), null);
  assert.equal(repo.countMarks(s.db, alice), 2);
});

// ---------- routes ----------

test('guests get 401 on every marks route', async (t) => {
  const { s } = await setup(t);
  for (const [method, url, body] of [
    ['GET', '/api/my/marks?map=main'],
    ['POST', '/api/my/marks', POINT],
    ['PATCH', '/api/my/marks/1', { title: 'x' }],
    ['DELETE', '/api/my/marks/1'],
  ]) {
    const r = await s.api(method, url, { body });
    assert.equal(r.status, 401, method + ' ' + url);
  }
});

test('an owner creates, lists, edits and deletes a mark', async (t) => {
  const { s, aliceCookie } = await setup(t);
  const c = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  assert.equal(c.status, 201);
  assert.equal(c.json.map, 'main');
  assert.equal(c.json.shape, 'point');
  assert.deepEqual(c.json.geometry, { x: 0.25, y: 0.75 });
  assert.equal(c.json.title, 'Stash');
  assert.equal(c.json.color, '#d4c24f');
  assert.equal(c.json.icon, 'question');
  assert.equal('user_id' in c.json, false);

  const list = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((m) => m.id), [c.json.id]);

  const p = await s.api('PATCH', '/api/my/marks/' + c.json.id, {
    cookie: aliceCookie,
    body: { title: 'Renamed', description: 'Behind the tower', color: '#112233', icon: 'cache', geometry: { x: 0.5, y: 0.5 } },
  });
  assert.equal(p.status, 200);
  assert.equal(p.json.title, 'Renamed');
  assert.equal(p.json.description, 'Behind the tower');
  assert.equal(p.json.color, '#112233');
  assert.equal(p.json.icon, 'cache');
  assert.deepEqual(p.json.geometry, { x: 0.5, y: 0.5 });

  const d = await s.api('DELETE', '/api/my/marks/' + c.json.id, { cookie: aliceCookie });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json, { ok: true });
  const after = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.deepEqual(after.json, []);
});

test('polygons and lines are accepted with their own geometry', async (t) => {
  const { s, aliceCookie } = await setup(t);
  const poly = await s.api('POST', '/api/my/marks', {
    cookie: aliceCookie,
    body: { map: 'main', shape: 'polygon', geometry: { points: [[0.1, 0.1], [0.5, 0.1], [0.3, 0.6]] } },
  });
  assert.equal(poly.status, 201);
  const line = await s.api('POST', '/api/my/marks', {
    cookie: aliceCookie,
    body: { map: 'main', shape: 'line', geometry: { points: [[0.1, 0.1], [0.9, 0.9]] } },
  });
  assert.equal(line.status, 201);
});

test('bad input is refused with 400 and nothing is stored', async (t) => {
  const { s, alice, aliceCookie } = await setup(t);
  const bad = [
    { ...POINT, shape: 'circle' },
    { ...POINT, geometry: { x: 2, y: 0 } },
    { ...POINT, geometry: { points: [[0, 0], [1, 1]] } },
    { ...POINT, shape: 'polygon', geometry: { points: [[0, 0], [1, 1]] } },
    { ...POINT, title: 'x'.repeat(81) },
    { ...POINT, description: 'x'.repeat(1001) },
    { ...POINT, color: 'red' },
    { ...POINT, icon: 'No Good' },
    { ...POINT, map: undefined },
    { ...POINT, map: 5 },
  ];
  for (const body of bad) {
    const r = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body });
    assert.ok(r.status === 400 || r.status === 404, JSON.stringify(body) + ' -> ' + r.status);
  }
  assert.equal(repo.countMarks(s.db, alice), 0);
});

test('an unknown or unpublished map is a 404 for both reading and creating', async (t) => {
  const { s, aliceCookie } = await setup(t);
  for (const slug of ['nope', 'draft']) {
    const g = await s.api('GET', '/api/my/marks?map=' + slug, { cookie: aliceCookie });
    assert.equal(g.status, 404, 'GET ' + slug);
    const p = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: { ...POINT, map: slug } });
    assert.equal(p.status, 404, 'POST ' + slug);
  }
  const noMap = await s.api('GET', '/api/my/marks', { cookie: aliceCookie });
  assert.equal(noMap.status, 404);
});

test('users never see or touch marks of other users (admin included): everything is 404', async (t) => {
  const { s, aliceCookie, bobCookie } = await setup(t);
  const m = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  const id = m.json.id;
  for (const cookie of [bobCookie, s.adminCookie]) {
    const list = await s.api('GET', '/api/my/marks?map=main', { cookie });
    assert.deepEqual(list.json, []);
    const patch = await s.api('PATCH', '/api/my/marks/' + id, { cookie, body: { title: 'hacked' } });
    assert.equal(patch.status, 404);
    const del = await s.api('DELETE', '/api/my/marks/' + id, { cookie });
    assert.equal(del.status, 404);
  }
  const missing = await s.api('PATCH', '/api/my/marks/99999', { cookie: bobCookie, body: { title: 'x' } });
  assert.equal(missing.status, 404, 'missing id looks the same as a foreign one');
  const still = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.equal(still.json[0].title, 'Stash');
});

test('marks never appear in the public map payload', async (t) => {
  const { s, aliceCookie } = await setup(t);
  await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: { ...POINT, title: 'SecretStashTitle' } });
  for (const cookie of [undefined, aliceCookie, s.adminCookie]) {
    const one = await s.api('GET', '/api/maps/main', { cookie });
    assert.equal(one.status, 200);
    assert.equal(JSON.stringify(one.json).includes('SecretStashTitle'), false);
    const all = await s.api('GET', '/api/maps', { cookie });
    assert.equal(JSON.stringify(all.json).includes('SecretStashTitle'), false);
  }
});

test('ownership and ids in the body are ignored on create', async (t) => {
  const { s, alice, bob, mapId, aliceCookie } = await setup(t);
  const r = await s.api('POST', '/api/my/marks', {
    cookie: aliceCookie,
    body: { ...POINT, user_id: bob, id: 999, map_id: 77, created_at: '2000-01-01 00:00:00' },
  });
  assert.equal(r.status, 201);
  assert.notEqual(r.json.id, 999);
  const row = repo.getMarkRaw(s.db, r.json.id);
  assert.equal(row.user_id, alice);
  assert.equal(row.map_id, mapId);
  assert.notEqual(row.created_at, '2000-01-01 00:00:00');
});

test('PATCH with nothing to change or with another shape is refused and the mark stays intact', async (t) => {
  const { s, aliceCookie } = await setup(t);
  const m = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  const empty = await s.api('PATCH', '/api/my/marks/' + m.json.id, { cookie: aliceCookie, body: {} });
  assert.equal(empty.status, 400);
  const shape = await s.api('PATCH', '/api/my/marks/' + m.json.id, { cookie: aliceCookie, body: { shape: 'polygon' } });
  assert.equal(shape.status, 400);
  const list = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.equal(list.json[0].shape, 'point');
  assert.equal(list.json[0].title, 'Stash');
  const badId = await s.api('PATCH', '/api/my/marks/abc', { cookie: aliceCookie, body: { title: 'x' } });
  assert.equal(badId.status, 404);
});

test('limits: 300 marks per user, 100 vertices', async (t) => {
  const { s, mapId, alice, aliceCookie, bobCookie } = await setup(t);
  const g = JSON.stringify({ x: 0, y: 0 });
  for (let i = 0; i < 300; i++) {
    repo.insertRow(s.db, 'user_marks', { user_id: alice, map_id: mapId, shape: 'point', geometry: g });
  }
  const over = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  assert.equal(over.status, 409);
  assert.equal(over.json.error, 'marks_limit');
  const other = await s.api('POST', '/api/my/marks', { cookie: bobCookie, body: POINT });
  assert.equal(other.status, 201, 'the limit is per user');

  const points = Array.from({ length: 101 }, (_, i) => [i / 200, 0.5]);
  const many = await s.api('POST', '/api/my/marks', { cookie: bobCookie, body: { map: 'main', shape: 'line', geometry: { points } } });
  assert.equal(many.status, 400);
});

test('write rate is limited per user, reads are not', async (t) => {
  const { s, aliceCookie, bobCookie } = await setup(t, {
    limiters: { marksWrite: createRateLimiter({ max: 2, windowMs: 60000 }) },
  });
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT })).status, 201);
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT })).status, 201);
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT })).status, 429);
  assert.equal((await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie })).status, 200);
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: bobCookie, body: POINT })).status, 201, 'another user is unaffected');
});

test('/api/me reports the marks capability', async (t) => {
  const { s, aliceCookie } = await setup(t);
  assert.equal((await s.api('GET', '/api/me')).json.can.marks, false);
  assert.equal((await s.api('GET', '/api/me', { cookie: aliceCookie })).json.can.marks, true);
});
