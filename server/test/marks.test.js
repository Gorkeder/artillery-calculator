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
