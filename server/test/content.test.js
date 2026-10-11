'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createUser, createSession } = require('../auth');

async function setup(t) {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const ck = s.adminCookie;
  const map = (await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'north', title: 'Север', published: true } })).json;
  const pt = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Тайники', shape: 'point', icon: 'cache' } })).json;
  const poly = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Заражение', shape: 'polygon', color: '#cc3322' } })).json;
  return { s, ck, map, pt, poly };
}

const tri = { points: [[0.1, 0.1], [0.4, 0.1], [0.3, 0.4]] };

test('anonymous and non-admin users cannot write', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const body = { slug: 'x', title: 'X' };
  assert.equal((await s.api('POST', '/api/maps', { body })).status, 401);
  createUser(s.db, { login: 'visitor', password: 'visitor-pass', role: 'user' });
  const uid = s.db.prepare("SELECT id FROM users WHERE login = 'visitor'").get().id;
  const cookie = 'sid=' + createSession(s.db, uid, Date.now());
  assert.equal((await s.api('POST', '/api/maps', { body, cookie })).status, 403);
});

test('map create/patch/delete and duplicate slug', async (t) => {
  const { s, ck, map } = await setup(t);
  assert.equal(map.published, true);
  const dup = await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'north', title: 'Другой' } });
  assert.equal(dup.status, 409);
  const bad = await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'Bad Slug', title: 'x' } });
  assert.equal(bad.status, 400);
  const p = await s.api('PATCH', '/api/maps/' + map.id, { cookie: ck, body: { title: 'Новый', published: false } });
  assert.equal(p.json.title, 'Новый');
  assert.equal(p.json.published, false);
  assert.equal((await s.api('PATCH', '/api/maps/' + map.id, { cookie: ck, body: {} })).status, 400);
  assert.equal((await s.api('PATCH', '/api/maps/9999', { cookie: ck, body: { title: 'x' } })).status, 404);
  assert.equal((await s.api('DELETE', '/api/maps/' + map.id, { cookie: ck })).status, 200);
  assert.equal((await s.api('GET', '/api/maps/north', { cookie: ck })).status, 404);
});

test('feature create validates geometry against the category shape', async (t) => {
  const { s, ck, map, pt, poly } = await setup(t);
  const ok = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0.2, y: 0.3 }, title: 'Т1' } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.geometry, { x: 0.2, y: 0.3 });
  assert.equal(ok.json.status, 'approved');
  assert.equal(ok.json.author_id, s.adminId);

  const wrongShape = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: tri } });
  assert.equal(wrongShape.status, 400);
  const outOfRange = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 1.5, y: 0 } } });
  assert.equal(outOfRange.status, 400);
  const strCoords = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: '0.5', y: '0.5' } } });
  assert.equal(strCoords.status, 400);
  const polyOk = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: poly.id, geometry: tri, color: '#112233', opacity: 0.4 } });
  assert.equal(polyOk.status, 201);
  assert.equal(polyOk.json.color, '#112233');
});

test('feature create rejects a category from another map', async (t) => {
  const { s, ck, map } = await setup(t);
  const other = (await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'south', title: 'Юг' } })).json;
  const foreign = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: other.id, name: 'Чужая', shape: 'point' } })).json;
  const r = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: foreign.id, geometry: { x: 0, y: 0 } } });
  assert.equal(r.status, 400);
});

test('moving a feature to a category with another shape is rejected', async (t) => {
  const { s, ck, map, pt, poly } = await setup(t);
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0.5, y: 0.5 } } })).json;
  const r = await s.api('PATCH', '/api/features/' + f.id, { cookie: ck, body: { category_id: poly.id } });
  assert.equal(r.status, 400);
  const g = await s.api('PATCH', '/api/features/' + f.id, { cookie: ck, body: { geometry: tri } });
  assert.equal(g.status, 400);
  const still = (await s.api('GET', '/api/maps/north', { cookie: ck })).json.features[0];
  assert.deepEqual(still.geometry, { x: 0.5, y: 0.5 });
});

test('changing a category shape is blocked while it has features', async (t) => {
  const { s, ck, map, pt } = await setup(t);
  await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0.5, y: 0.5 } } });
  const blocked = await s.api('PATCH', '/api/categories/' + pt.id, { cookie: ck, body: { shape: 'polygon' } });
  assert.equal(blocked.status, 409);
  const same = await s.api('PATCH', '/api/categories/' + pt.id, { cookie: ck, body: { shape: 'point', name: 'Схроны' } });
  assert.equal(same.status, 200);
  assert.equal(same.json.name, 'Схроны');
  const empty = await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Пустая', shape: 'line' } });
  const flip = await s.api('PATCH', '/api/categories/' + empty.json.id, { cookie: ck, body: { shape: 'polygon' } });
  assert.equal(flip.status, 200);
});

test('feature patch updates fields, geometry, resets colour with null', async (t) => {
  const { s, ck, map, poly } = await setup(t);
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: poly.id, geometry: tri, color: '#112233' } })).json;
  const r = await s.api('PATCH', '/api/features/' + f.id, {
    cookie: ck,
    body: { title: 'Зона №1', description: 'Опасно!\nРадиация', color: null, opacity: 0.6, geometry: { points: [[0, 0], [1, 0], [1, 1]] } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.title, 'Зона №1');
  assert.equal(r.json.description, 'Опасно!\nРадиация');
  assert.equal(r.json.color, null);
  assert.equal(r.json.opacity, 0.6);
  assert.equal(r.json.geometry.points.length, 3);
});

test('cyrillic and emoji text round-trips unchanged', async (t) => {
  const { s, ck, map, pt } = await setup(t);
  const title = 'Тайник «Свалка» 🔑';
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0, y: 0 }, title, description: 'Ёё — ъ' } })).json;
  const got = (await s.api('GET', '/api/maps/north')).json.features.find((x) => x.id === f.id);
  assert.equal(got.title, title);
  assert.equal(got.description, 'Ёё — ъ');
});

test('deleting a feature and a category removes their rows', async (t) => {
  const { s, ck, map, pt } = await setup(t);
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0, y: 0 } } })).json;
  assert.equal((await s.api('DELETE', '/api/features/' + f.id, { cookie: ck })).status, 200);
  assert.equal((await s.api('DELETE', '/api/features/' + f.id, { cookie: ck })).status, 404);
  await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0, y: 0 } } });
  assert.equal((await s.api('DELETE', '/api/categories/' + pt.id, { cookie: ck })).status, 200);
  const data = (await s.api('GET', '/api/maps/north', { cookie: ck })).json;
  assert.equal(data.features.length, 0);
});

test('malformed json body is a 400, not a 500', async (t) => {
  const { s, ck } = await setup(t);
  const r = await s.api('POST', '/api/maps', { cookie: ck, raw: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
});
