'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h, pad = 0) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9), Buffer.alloc(pad),
  ]);

async function setup(t) {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const ck = s.adminCookie;
  const map = (await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'north', title: 'Север', published: true } })).json;
  const cat = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Т', shape: 'point' } })).json;
  const feat = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: cat.id, geometry: { x: 0.5, y: 0.5 } } })).json;
  const onDisk = (url) => fs.existsSync(path.join(s.uploadsDir, url.replace(/^\/uploads\//, '')));
  return { s, ck, map, cat, feat, onDisk };
}

test('map image upload stores the file and records its size', async (t) => {
  const { s, ck, map, onDisk } = await setup(t);
  const r = await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(640, 480), headers: { 'content-type': 'image/png' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.width, 640);
  assert.equal(r.json.height, 480);
  assert.match(r.json.image_url, /^\/uploads\/maps\/[0-9a-f]{32}\.png$/);
  assert.ok(onDisk(r.json.image_url));
});

test('replacing the map image deletes the old file and keeps features untouched', async (t) => {
  const { s, ck, map, feat, onDisk } = await setup(t);
  const first = (await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(100, 100) })).json;
  const second = (await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(200, 400) })).json;
  assert.notEqual(first.image_url, second.image_url);
  assert.equal(onDisk(first.image_url), false);
  assert.ok(onDisk(second.image_url));
  const data = (await s.api('GET', '/api/maps/north', { cookie: ck })).json;
  assert.equal(data.map.width, 200);
  assert.deepEqual(data.features[0].geometry, { x: 0.5, y: 0.5 });
  assert.equal(data.features[0].id, feat.id);
});

test('fake or broken image bodies are rejected even with an image content-type', async (t) => {
  const { s, ck, map } = await setup(t);
  const url = `/api/maps/${map.id}/image`;
  const headers = { 'content-type': 'image/png' };
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const truncated = png(10, 10).subarray(0, 12);
  for (const raw of [svg, html, truncated, Buffer.alloc(0)]) {
    const r = await s.api('PUT', url, { cookie: ck, raw, headers });
    assert.equal(r.status, 400, 'body of length ' + raw.length);
  }
  assert.equal(fs.readdirSync(s.uploadsDir).length, 0);
});

test('images over 8 MB are rejected with 413 and nothing is stored', async (t) => {
  const { s, ck, map } = await setup(t);
  const big = png(10, 10, 8 * 1024 * 1024);
  const r = await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: big });
  assert.equal(r.status, 413);
  assert.equal(fs.readdirSync(s.uploadsDir).length, 0);
});

test('absurd image dimensions are rejected', async (t) => {
  const { s, ck, map } = await setup(t);
  const r = await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(100000, 100000) });
  assert.equal(r.status, 400);
});

test('image endpoints require admin', async (t) => {
  const { s, map, feat } = await setup(t);
  assert.equal((await s.api('PUT', `/api/maps/${map.id}/image`, { raw: png(1, 1) })).status, 401);
  assert.equal((await s.api('PUT', `/api/features/${feat.id}/images`, { raw: png(1, 1) })).status, 401);
});

test('feature photos: add, list in feature payload, limit of 10, delete removes the file', async (t) => {
  const { s, ck, feat, onDisk } = await setup(t);
  const added = [];
  for (let i = 0; i < 10; i++) {
    const r = await s.api('PUT', `/api/features/${feat.id}/images`, { cookie: ck, raw: png(5 + i, 5) });
    assert.equal(r.status, 201);
    added.push(r.json);
  }
  const eleventh = await s.api('PUT', `/api/features/${feat.id}/images`, { cookie: ck, raw: png(5, 5) });
  assert.equal(eleventh.status, 409);
  const data = (await s.api('GET', '/api/maps/north')).json;
  assert.equal(data.features[0].images.length, 10);
  assert.ok(onDisk(added[0].url));
  const del = await s.api('DELETE', `/api/feature-images/${added[0].id}`, { cookie: ck });
  assert.equal(del.status, 200);
  assert.equal(onDisk(added[0].url), false);
  assert.equal((await s.api('DELETE', `/api/feature-images/${added[0].id}`, { cookie: ck })).status, 404);
});

test('deleting a feature, a category or a map removes their photo files (no orphans)', async (t) => {
  const { s, ck, map, cat, feat, onDisk } = await setup(t);
  const mk = async (featureId) => (await s.api('PUT', `/api/features/${featureId}/images`, { cookie: ck, raw: png(8, 8) })).json.url;
  const mapImg = (await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(50, 50) })).json.image_url;

  const a = await mk(feat.id);
  assert.equal((await s.api('DELETE', '/api/features/' + feat.id, { cookie: ck })).status, 200);
  assert.equal(onDisk(a), false);

  const f2 = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: cat.id, geometry: { x: 0, y: 0 } } })).json;
  const b = await mk(f2.id);
  assert.equal((await s.api('DELETE', '/api/categories/' + cat.id, { cookie: ck })).status, 200);
  assert.equal(onDisk(b), false);

  const cat2 = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'К2', shape: 'point' } })).json;
  const f3 = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: cat2.id, geometry: { x: 0, y: 0 } } })).json;
  const c = await mk(f3.id);
  assert.ok(onDisk(mapImg) && onDisk(c));
  assert.equal((await s.api('DELETE', '/api/maps/' + map.id, { cookie: ck })).status, 200);
  assert.equal(onDisk(c), false);
  assert.equal(onDisk(mapImg), false);
});

test('feature photos get the same truncated/broken-file check as map images', async (t) => {
  const { s, ck, feat } = await setup(t);
  const url = `/api/features/${feat.id}/images`;
  const truncated = png(10, 10).subarray(0, 12);
  const sigOnly = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const raw of [truncated, sigOnly, Buffer.from('<svg/>')]) {
    const r = await s.api('PUT', url, { cookie: ck, raw, headers: { 'content-type': 'image/png' } });
    assert.equal(r.status, 400, 'body of length ' + raw.length);
  }
  assert.equal(fs.existsSync(path.join(s.uploadsDir, 'features')), false);
  const data = (await s.api('GET', '/api/maps/north', { cookie: ck })).json;
  assert.equal(data.features[0].images.length, 0);
});
