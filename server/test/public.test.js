'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

function seed(db) {
  db.prepare("INSERT INTO maps (slug, title, width, height, image_path, published, sort) VALUES ('pub', 'Pub', 100, 50, 'maps/a.png', 1, 0)").run();
  db.prepare("INSERT INTO maps (slug, title, published, sort) VALUES ('draft', 'Draft', 0, 1)").run();
  db.prepare("INSERT INTO categories (map_id, name, shape) VALUES (1, 'Тайники', 'point')").run();
  db.prepare(`INSERT INTO features (map_id, category_id, geometry, title, status) VALUES (1, 1, '{"x":0.5,"y":0.5}', 'Открытый', 'approved')`).run();
  db.prepare(`INSERT INTO features (map_id, category_id, geometry, title, status) VALUES (1, 1, '{"x":0.1,"y":0.1}', 'Ждёт', 'pending')`).run();
  db.prepare("INSERT INTO feature_images (feature_id, path) VALUES (1, 'features/p.jpg')").run();
}

test('GET /api/maps lists only published maps for anonymous visitors', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((m) => m.slug), ['pub']);
  assert.equal(r.json[0].image_url, '/uploads/maps/a.png');
});

test('GET /api/maps includes unpublished maps for admin', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps', { cookie: s.adminCookie });
  assert.deepEqual(r.json.map((m) => m.slug), ['pub', 'draft']);
});

test('GET /api/maps/:slug returns categories and only approved features with photo urls', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps/pub');
  assert.equal(r.status, 200);
  assert.equal(r.json.map.slug, 'pub');
  assert.equal(r.json.categories.length, 1);
  assert.equal(r.json.categories[0].visible_default, true);
  assert.deepEqual(r.json.features.map((f) => f.title), ['Открытый']);
  assert.deepEqual(r.json.features[0].geometry, { x: 0.5, y: 0.5 });
  assert.deepEqual(r.json.features[0].images.map((i) => i.url), ['/uploads/features/p.jpg']);
});

test('admin also sees pending features', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps/pub', { cookie: s.adminCookie });
  assert.deepEqual(r.json.features.map((f) => f.title), ['Открытый', 'Ждёт']);
});

test('unpublished map is 404 for anonymous, visible for admin', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  assert.equal((await s.api('GET', '/api/maps/draft')).status, 404);
  assert.equal((await s.api('GET', '/api/maps/draft', { cookie: s.adminCookie })).status, 200);
  assert.equal((await s.api('GET', '/api/maps/nope')).status, 404);
});

test('unknown api route is a json 404', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('GET', '/api/nothing');
  assert.equal(r.status, 404);
  assert.equal(typeof r.json.error, 'string');
});

test('non-GET requests without X-Requested-With are rejected with 403', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const res = await fetch(s.base + '/api/maps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});
