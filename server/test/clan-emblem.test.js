'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clanSetup } = require('./clan-helpers');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h, pad = 0) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9), Buffer.alloc(pad),
  ]);
const PNG_HEADERS = { 'content-type': 'image/png' };

test('emblem upload, replace, reset and cleanup on clan delete', async (t) => {
  const { s, as, makeClan, addMember } = await clanSetup(t);
  const onDisk = (url) => fs.existsSync(path.join(s.uploadsDir, url.replace(/^\/uploads\//, '')));
  const id = await makeClan();
  addMember(id, 'bob');
  assert.equal((await as('bob')('PUT', `/api/clans/${id}/emblem`, undefined, { raw: png(64, 64), headers: PNG_HEADERS })).status, 403);
  const r1 = await as('alice')('PUT', `/api/clans/${id}/emblem`, undefined, { raw: png(64, 64), headers: PNG_HEADERS });
  assert.equal(r1.status, 200);
  const first = r1.json.clan.emblem_url;
  assert.match(first, /^\/uploads\/clans\/[0-9a-f]{32}\.png$/);
  assert.ok(onDisk(first));
  const r2 = await as('alice')('PUT', `/api/clans/${id}/emblem`, undefined, { raw: png(128, 128), headers: PNG_HEADERS });
  const second = r2.json.clan.emblem_url;
  assert.notEqual(second, first);
  assert.equal(onDisk(first), false, 'the old file is removed');
  const reset = await as('admin')('DELETE', `/api/clans/${id}/emblem`);
  assert.equal(reset.status, 200);
  assert.equal(onDisk(second), false);
  assert.equal((await as('alice')('GET', '/api/my/clan')).json.clan.emblem_url, null);
  const r3 = await as('alice')('PUT', `/api/clans/${id}/emblem`, undefined, { raw: png(64, 64), headers: PNG_HEADERS });
  await as('alice')('DELETE', `/api/clans/${id}`);
  assert.equal(onDisk(r3.json.clan.emblem_url), false, 'deleting the clan deletes the file');
});

test('emblem limits: type, sides and 200 KB', async (t) => {
  const { as, makeClan } = await clanSetup(t);
  const id = await makeClan();
  const put = (raw) => as('alice')('PUT', `/api/clans/${id}/emblem`, undefined, { raw, headers: PNG_HEADERS });
  const gif = await put(Buffer.from('GIF89a' + 'x'.repeat(30)));
  assert.deepEqual([gif.status, gif.json.error], [400, 'emblem_invalid']);
  const big = await put(png(2048, 2048));
  assert.deepEqual([big.status, big.json.error], [400, 'emblem_invalid']);
  assert.equal((await put(png(64, 64, 201 * 1024))).status, 413);
  assert.equal((await put(Buffer.alloc(0))).status, 400);
});
