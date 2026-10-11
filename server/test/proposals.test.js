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

// ---------- user features ----------

test('a proposal is created as pending, owned by the user, admin-only fields are ignored', async (t) => {
  const ctx = await setup(t);
  const r = await propose(ctx, ctx.aliceCookie, {
    color: '#ff0000', opacity: 0.9, status: 'approved', author_id: ctx.bob, reject_reason: 'x', reviewed_by: 1,
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.mine, true);
  assert.equal('author_id' in r.json, false);
  assert.equal(r.json.color, null);
  assert.equal(r.json.opacity, null);
  const row = repo.rawFeature(ctx.s.db, r.json.id);
  assert.equal(row.author_id, ctx.alice);
  assert.equal(row.reject_reason, null);
  assert.equal(row.reviewed_by, null);
  const adm = await ctx.s.api('POST', '/api/features', { cookie: ctx.s.adminCookie, body: body(ctx, { title: 'Admin' }) });
  assert.equal(adm.status, 201);
  assert.equal(adm.json.status, 'approved');
  assert.equal(adm.json.author_id, ctx.s.adminId);
});

test('guests, blocked authors and unpublished maps cannot receive proposals', async (t) => {
  const ctx = await setup(t);
  assert.equal((await propose(ctx, undefined)).status, 401);
  assert.equal((await propose(ctx, ctx.aliceCookie, { map_id: ctx.draftId })).status, 404);
  block(ctx, ctx.alice);
  const r = await propose(ctx, ctx.aliceCookie);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'proposals_blocked');
  assert.equal((await propose(ctx, ctx.bobCookie)).status, 201, 'other users are unaffected');
});

test('at most 10 open proposals per user; rejected ones do not count', async (t) => {
  const ctx = await setup(t);
  for (let i = 0; i < 10; i++) seedFeature(ctx, { status: 'pending', title: 'P' + i });
  const over = await propose(ctx, ctx.aliceCookie);
  assert.equal(over.status, 409);
  assert.equal(over.json.error, 'proposals_limit');
  ctx.s.db.prepare("UPDATE features SET reject_reason = 'no' WHERE author_id = ? AND title = 'P0'").run(ctx.alice);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201, 'a rejected proposal frees a slot');
  assert.equal((await propose(ctx, ctx.bobCookie)).status, 201, 'the limit is per user');
});

test('an author edits only their own open proposal', async (t) => {
  const ctx = await setup(t);
  const p = (await propose(ctx, ctx.aliceCookie)).json;
  const url = '/api/features/' + p.id;
  const ok = await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { title: 'Renamed', color: '#00ff00', status: 'approved', author_id: ctx.bob } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.title, 'Renamed');
  assert.equal(ok.json.color, null, 'color is ignored for users');
  assert.equal(ok.json.status, 'pending');
  assert.equal(repo.rawFeature(ctx.s.db, p.id).author_id, ctx.alice);
  assert.equal((await ctx.s.api('PATCH', url, { cookie: ctx.bobCookie, body: { title: 'hack' } })).status, 404);
  assert.equal((await ctx.s.api('PATCH', url, { body: { title: 'hack' } })).status, 401);
  const wrongShape = await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { category_id: ctx.polyCat } });
  assert.equal(wrongShape.status, 400, 'a point cannot move into a polygon category');
  // Rejected: no more edits.
  ctx.s.db.prepare("UPDATE features SET reject_reason = 'dup' WHERE id = ?").run(p.id);
  assert.equal((await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { title: 'again' } })).status, 404);
  // Published: no more edits.
  ctx.s.db.prepare("UPDATE features SET reject_reason = NULL, status = 'approved' WHERE id = ?").run(p.id);
  assert.equal((await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { title: 'again' } })).status, 404);
  assert.equal(repo.rawFeature(ctx.s.db, p.id).title, 'Renamed');
});

test('an author deletes their pending or rejected proposal, never a published or foreign one', async (t) => {
  const ctx = await setup(t);
  const open = seedFeature(ctx, { status: 'pending' });
  const rejected = seedFeature(ctx, { status: 'pending', rejectReason: 'dup' });
  const published = seedFeature(ctx, { status: 'approved' });
  const foreign = seedFeature(ctx, { status: 'pending', author: ctx.bob });
  const del = (id, cookie) => ctx.s.api('DELETE', '/api/features/' + id, { cookie });
  assert.equal((await del(foreign, ctx.aliceCookie)).status, 404);
  assert.equal((await del(published, ctx.aliceCookie)).status, 404);
  assert.equal((await del(open, ctx.aliceCookie)).status, 200);
  assert.equal((await del(rejected, ctx.aliceCookie)).status, 200);
  assert.equal((await del(open, undefined)).status, 401);
  assert.equal(repo.rawFeature(ctx.s.db, published).title, 'Seed');
  assert.equal((await del(published, ctx.s.adminCookie)).status, 200, 'admin deletes anything');
});

test('public output hides author_id and foreign pending objects; authors see their own status', async (t) => {
  const ctx = await setup(t);
  const mine = (await propose(ctx, ctx.aliceCookie, { title: 'Mine' })).json;
  seedFeature(ctx, { status: 'approved', author: ctx.bob, title: 'Public' });
  seedFeature(ctx, { status: 'pending', rejectReason: 'duplicate', author: ctx.alice, title: 'Rejected' });
  const guest = await features(ctx, undefined);
  assert.deepEqual(guest.map((f) => f.title), ['Public']);
  assert.equal('author_id' in guest[0], false);
  assert.equal(guest[0].mine, false);
  assert.equal(guest[0].reject_reason, null);
  const bobView = await features(ctx, ctx.bobCookie);
  assert.deepEqual(bobView.map((f) => f.title), ['Public']);
  assert.equal(bobView[0].mine, true, 'bob is the author of the published one');
  assert.equal('author_id' in bobView[0], false);
  const aliceView = await features(ctx, ctx.aliceCookie);
  assert.deepEqual(aliceView.map((f) => f.title).sort(), ['Mine', 'Public', 'Rejected']);
  const rejected = aliceView.find((f) => f.title === 'Rejected');
  assert.equal(rejected.reject_reason, 'duplicate');
  assert.equal(aliceView.find((f) => f.id === mine.id).status, 'pending');
  const admin = await features(ctx, ctx.s.adminCookie);
  assert.equal(admin.length, 3);
  assert.equal(admin.find((f) => f.title === 'Mine').author_id, ctx.alice);
});

test('users cannot upload photos', async (t) => {
  const ctx = await setup(t);
  const p = (await propose(ctx, ctx.aliceCookie)).json;
  const r = await ctx.s.api('PUT', '/api/features/' + p.id + '/images', {
    cookie: ctx.aliceCookie, raw: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  assert.equal(r.status, 403);
});

test('proposal writes are rate limited per user, reads are not', async (t) => {
  const ctx = await setup(t, { limiters: { proposalsWrite: createRateLimiter({ max: 2, windowMs: 60000 }) } });
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 429);
  assert.equal((await ctx.s.api('GET', '/api/maps/main', { cookie: ctx.aliceCookie })).status, 200);
  assert.equal((await propose(ctx, ctx.bobCookie)).status, 201, 'another user is unaffected');
});

// ---------- moderation ----------

const post = (ctx, url, cookie, bodyIn) => ctx.s.api('POST', url, { cookie, body: bodyIn || {} });

test('only the admin reads the moderation queue, and it lists open proposals only', async (t) => {
  const ctx = await setup(t);
  seedFeature(ctx, { status: 'pending', title: 'Open' });
  seedFeature(ctx, { status: 'pending', rejectReason: 'dup', title: 'Rejected' });
  seedFeature(ctx, { status: 'approved', title: 'Published' });
  assert.equal((await ctx.s.api('GET', '/api/moderation')).status, 401);
  assert.equal((await ctx.s.api('GET', '/api/moderation', { cookie: ctx.aliceCookie })).status, 403);
  const r = await ctx.s.api('GET', '/api/moderation', { cookie: ctx.s.adminCookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.proposals.map((p) => p.title), ['Open']);
  assert.equal(r.json.proposals[0].author_login, 'alice');
  assert.equal(r.json.proposals[0].map_slug, 'main');
  assert.equal(r.json.proposals[0].category_name, 'Cache');
  assert.deepEqual(r.json.reports, []);
  assert.deepEqual(r.json.blocked, []);
});

test('approve publishes a proposal, repeats are 409, a rejected one can be approved', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'pending', title: 'To publish' });
  assert.equal((await post(ctx, `/api/features/${id}/approve`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/features/${id}/approve`, undefined)).status, 401);
  const ok = await post(ctx, `/api/features/${id}/approve`, ctx.s.adminCookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'approved');
  const row = repo.rawFeature(ctx.s.db, id);
  assert.equal(row.reviewed_by, ctx.s.adminId);
  assert.ok(row.reviewed_at);
  assert.deepEqual((await features(ctx, ctx.bobCookie)).map((f) => f.title), ['To publish']);
  assert.equal((await post(ctx, `/api/features/${id}/approve`, ctx.s.adminCookie)).status, 409);
  assert.equal((await post(ctx, '/api/features/99999/approve', ctx.s.adminCookie)).status, 404);
  const back = seedFeature(ctx, { status: 'pending', rejectReason: 'no', title: 'Second chance' });
  const again = await post(ctx, `/api/features/${back}/approve`, ctx.s.adminCookie);
  assert.equal(again.status, 200);
  assert.equal(repo.rawFeature(ctx.s.db, back).reject_reason, null);
});

test('reject needs a reason of 1..200 characters and never touches a published object', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'pending' });
  for (const reason of [undefined, '', '   ', 5, 'x'.repeat(201)]) {
    const r = await post(ctx, `/api/features/${id}/reject`, ctx.s.adminCookie, { reason });
    assert.equal(r.status, 400, JSON.stringify(reason));
  }
  assert.equal((await post(ctx, `/api/features/${id}/reject`, ctx.aliceCookie, { reason: 'x' })).status, 403);
  const ok = await post(ctx, `/api/features/${id}/reject`, ctx.s.adminCookie, { reason: ' Дубликат ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.reject_reason, 'Дубликат');
  const aliceView = (await features(ctx, ctx.aliceCookie)).find((f) => f.id === id);
  assert.equal(aliceView.reject_reason, 'Дубликат');
  assert.equal((await features(ctx, ctx.bobCookie)).length, 0, 'others never see it');
  const pub = seedFeature(ctx, { status: 'approved', title: 'Published' });
  const bad = await post(ctx, `/api/features/${pub}/reject`, ctx.s.adminCookie, { reason: 'x' });
  assert.equal(bad.status, 409);
  assert.equal(repo.rawFeature(ctx.s.db, pub).status, 'approved');
});

test('blocking an author rejects their open proposals only and leaves sign-in and marks working', async (t) => {
  const ctx = await setup(t);
  const open1 = seedFeature(ctx, { status: 'pending', title: 'Open 1' });
  const open2 = seedFeature(ctx, { status: 'pending', title: 'Open 2' });
  const old = seedFeature(ctx, { status: 'pending', rejectReason: 'dup', title: 'Already rejected' });
  const pub = seedFeature(ctx, { status: 'approved', title: 'Published' });
  const bobs = seedFeature(ctx, { status: 'pending', author: ctx.bob, title: 'Bob open' });
  assert.equal((await post(ctx, `/api/users/${ctx.alice}/block-proposals`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/users/${ctx.s.adminId}/block-proposals`, ctx.s.adminCookie)).status, 400, 'admins cannot be blocked');
  assert.equal((await post(ctx, '/api/users/99999/block-proposals', ctx.s.adminCookie)).status, 404);
  const r = await post(ctx, `/api/users/${ctx.alice}/block-proposals`, ctx.s.adminCookie, { reason: 'spam' });
  assert.equal(r.status, 200);
  assert.equal(r.json.rejected, 2);
  const reason = (id) => repo.rawFeature(ctx.s.db, id).reject_reason;
  assert.equal(reason(open1), 'Автор заблокирован');
  assert.equal(reason(open2), 'Автор заблокирован');
  assert.equal(reason(old), 'dup', 'an earlier reason is kept');
  assert.equal(repo.rawFeature(ctx.s.db, pub).status, 'approved');
  assert.equal(reason(bobs), null, 'other authors are untouched');
  // The block is visible to the user and closes proposals only.
  const me = await ctx.s.api('GET', '/api/me', { cookie: ctx.aliceCookie });
  assert.equal(me.json.user.proposalsBlocked, true);
  assert.equal(me.json.user.blockReason, 'spam');
  assert.equal(me.json.can.propose, false);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 403);
  const mark = await ctx.s.api('POST', '/api/my/marks', {
    cookie: ctx.aliceCookie, body: { map: 'main', shape: 'point', geometry: { x: 0.5, y: 0.5 } },
  });
  assert.equal(mark.status, 201, 'personal marks keep working');
  const queue = await ctx.s.api('GET', '/api/moderation', { cookie: ctx.s.adminCookie });
  assert.deepEqual(queue.json.blocked.map((b) => [b.login, b.reason]), [['alice', 'spam']]);
  assert.deepEqual(queue.json.proposals.map((p) => p.title), ['Bob open']);
});

test('unblocking restores proposing but does not revive rejected proposals', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'pending' });
  await post(ctx, `/api/users/${ctx.alice}/block-proposals`, ctx.s.adminCookie);
  assert.equal((await post(ctx, `/api/users/${ctx.alice}/unblock-proposals`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/users/${ctx.alice}/unblock-proposals`, ctx.s.adminCookie)).status, 200);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201);
  assert.equal(repo.rawFeature(ctx.s.db, id).reject_reason, 'Автор заблокирован');
  assert.equal((await post(ctx, '/api/users/99999/unblock-proposals', ctx.s.adminCookie)).status, 404);
});
