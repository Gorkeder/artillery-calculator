'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startTestServer } = require('./helpers');
const { SCHEMA, MIGRATIONS, migrate } = require('../db');
const { createRateLimiter, createUser, createSession } = require('../auth');
const { cleanup } = require('../tokens');
const repo = require('../repo');

async function setup(t, opts) {
  const s = await startTestServer(opts);
  t.after(() => s.cleanup());
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const draftId = repo.insertRow(s.db, 'maps', { slug: 'draft', title: 'Draft', published: 0 });
  const pointCat = repo.insertRow(s.db, 'categories', { map_id: mapId, name: 'Cache', shape: 'point' });
  const polyCat = repo.insertRow(s.db, 'categories', { map_id: mapId, name: 'Zone', shape: 'polygon' });
  const alice = createUser(s.db, { login: 'alice', password: 'alice-pass-1', role: 'user' });
  const bob = createUser(s.db, { login: 'bob', password: 'bob-pass-12', role: 'user' });
  const cookieFor = (id) => 'sid=' + createSession(s.db, id, Date.now());
  return { s, mapId, draftId, pointCat, polyCat, alice, bob, aliceCookie: cookieFor(alice), bobCookie: cookieFor(bob) };
}

const body = (ctx, over = {}) => ({
  map_id: ctx.mapId, category_id: ctx.pointCat, geometry: { x: 0.3, y: 0.4 }, title: 'Cache A', description: 'Under the bridge', ...over,
});
const propose = (ctx, cookie, over) => ctx.s.api('POST', '/api/features', { cookie, body: body(ctx, over) });
const features = async (ctx, cookie) => (await ctx.s.api('GET', '/api/maps/main', { cookie })).json.features;
const block = (ctx, userId, reason = 'spam') =>
  ctx.s.db.prepare("UPDATE users SET proposals_blocked_at = datetime('now'), proposals_block_reason = ? WHERE id = ?").run(reason, userId);
// Inserts a feature straight into the DB: { status, rejectReason, author }.
function seedFeature(ctx, { status = 'approved', rejectReason = null, author = ctx.alice, title = 'Seed', category = ctx.pointCat, reviewedAt = null } = {}) {
  return repo.insertRow(ctx.s.db, 'features', {
    map_id: ctx.mapId, category_id: category, geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
    title, status, reject_reason: rejectReason, author_id: author, reviewed_at: reviewedAt,
  });
}

// ---------- migration 4 ----------

test('migration 4 upgrades a version 3 database without losing data', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const m of MIGRATIONS.filter((x) => x.version <= 3)) db.exec(m.sql);
  db.exec('PRAGMA user_version = 3');
  db.exec("INSERT INTO users (login, password_hash, role) VALUES ('old', 'x', 'user')");
  db.exec("INSERT INTO maps (slug, title, published) VALUES ('m', 'M', 1)");
  db.exec("INSERT INTO categories (map_id, name, shape) VALUES (1, 'C', 'point')");
  db.exec(`INSERT INTO features (map_id, category_id, geometry, title, status, author_id)
           VALUES (1, 1, '{"x":0,"y":0}', 'F', 'pending', 1)`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  const f = db.prepare('SELECT title, status, reject_reason, reviewed_at, reviewed_by FROM features').get();
  assert.deepEqual({ ...f }, { title: 'F', status: 'pending', reject_reason: null, reviewed_at: null, reviewed_by: null });
  const u = db.prepare('SELECT login, proposals_blocked_at, proposals_block_reason FROM users').get();
  assert.deepEqual({ ...u }, { login: 'old', proposals_blocked_at: null, proposals_block_reason: null });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 0);
  db.close();
});

// ---------- session user and /api/me ----------

test('/api/me and login report the proposals block', async (t) => {
  const ctx = await setup(t);
  block(ctx, ctx.alice, 'spam');
  const me = await ctx.s.api('GET', '/api/me', { cookie: ctx.aliceCookie });
  assert.equal(me.json.user.proposalsBlocked, true);
  assert.equal(me.json.user.blockReason, 'spam');
  const login = await ctx.s.api('POST', '/api/login', { body: { login: 'alice', password: 'alice-pass-1' } });
  assert.equal(login.status, 200, 'a blocked author can still sign in');
  assert.equal(login.json.user.proposalsBlocked, true);
  const clean = await ctx.s.api('GET', '/api/me', { cookie: ctx.bobCookie });
  assert.equal(clean.json.user.proposalsBlocked, false);
  assert.equal(clean.json.user.blockReason, null);
});
