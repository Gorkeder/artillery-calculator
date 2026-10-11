'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../validate');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9),
  ]);
const jpeg = (w, h) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const le24 = (n) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
const webpX = (w, h) =>
  Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('VP8X'),
    Buffer.from([10, 0, 0, 0]), Buffer.alloc(4), le24(w - 1), le24(h - 1),
  ]);

test('validateGeometry accepts a point in the unit square', () => {
  assert.deepEqual(v.validateGeometry('point', { x: 0, y: 1, extra: 1 }), { ok: true, value: { x: 0, y: 1 } });
});

test('validateGeometry rejects out-of-range, non-numeric and non-finite coordinates', () => {
  for (const bad of [{ x: 1.01, y: 0 }, { x: -0.1, y: 0 }, { x: '0.5', y: 0 }, { x: null, y: 0 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, {}]) {
    assert.equal(v.validateGeometry('point', bad).ok, false, JSON.stringify(bad));
  }
});

test('validateGeometry polygon needs 3+ points, line needs 2+', () => {
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0]] }).ok, false);
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0], [1, 1]] }).ok, true);
  assert.equal(v.validateGeometry('line', { points: [[0, 0]] }).ok, false);
  assert.equal(v.validateGeometry('line', { points: [[0, 0], [1, 1]] }).ok, true);
});

test('validateGeometry rejects malformed points and oversized point lists', () => {
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0], [2, 1]] }).ok, false);
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0], 'x'] }).ok, false);
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0, 0], [1, 0], [1, 1]] }).ok, false);
  const many = Array.from({ length: 2001 }, () => [0.5, 0.5]);
  assert.equal(v.validateGeometry('polygon', { points: many }).ok, false);
  assert.equal(v.validateGeometry('hexagon', { x: 0, y: 0 }).ok, false);
});

test('validateCategory create requires a name and checks every field', () => {
  assert.equal(v.validateCategory({}, { create: true }).ok, false);
  const r = v.validateCategory(
    { name: '  Тайники ', color: '#aabbcc', icon: 'cache', shape: 'point', visible_default: false, sort: 3 },
    { create: true },
  );
  assert.deepEqual(r.value, { name: 'Тайники', color: '#aabbcc', icon: 'cache', shape: 'point', visible_default: 0, sort: 3 });
  assert.equal(v.validateCategory({ color: 'red' }).ok, false);
  assert.equal(v.validateCategory({ icon: '<script>' }).ok, false);
  assert.equal(v.validateCategory({ shape: 'circle' }).ok, false);
  assert.equal(v.validateCategory({ name: 'x'.repeat(61) }).ok, false);
});

test('validateCategory partial update only returns provided fields', () => {
  assert.deepEqual(v.validateCategory({ color: '#000000' }).value, { color: '#000000' });
});

test('validateFeature checks title, description, color and opacity', () => {
  assert.deepEqual(v.validateFeature({ title: 'Т', description: 'd', color: null, opacity: 0.5 }).value, {
    title: 'Т', description: 'd', color: null, opacity: 0.5,
  });
  assert.equal(v.validateFeature({ title: 'x'.repeat(121) }).ok, false);
  assert.equal(v.validateFeature({ description: 'x'.repeat(4001) }).ok, false);
  assert.equal(v.validateFeature({ color: 'blue' }).ok, false);
  assert.equal(v.validateFeature({ opacity: 1.5 }).ok, false);
  assert.equal(v.validateFeature({ title: 5 }).ok, false);
});

test('validateMap create needs slug and title; slug charset is restricted', () => {
  assert.equal(v.validateMap({ title: 'T' }, { create: true }).ok, false);
  assert.equal(v.validateMap({ slug: 'Wild North', title: 'T' }, { create: true }).ok, false);
  assert.deepEqual(v.validateMap({ slug: 'wild-north', title: ' Дикий север ', published: true }, { create: true }).value, {
    slug: 'wild-north', title: 'Дикий север', published: 1,
  });
  assert.equal(v.validateMap({ published: 'yes' }).ok, false);
});

test('sniffImageType detects png/jpeg/webp by signature and rejects everything else', () => {
  assert.equal(v.sniffImageType(png(1, 1)), 'png');
  assert.equal(v.sniffImageType(jpeg(1, 1)), 'jpeg');
  assert.equal(v.sniffImageType(webpX(1, 1)), 'webp');
  assert.equal(v.sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(v.sniffImageType(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(v.sniffImageType(Buffer.alloc(0)), null);
});

test('imageSize reads dimensions of png, jpeg and webp', () => {
  assert.deepEqual(v.imageSize(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(v.imageSize(jpeg(300, 200)), { width: 300, height: 200 });
  assert.deepEqual(v.imageSize(webpX(1024, 768)), { width: 1024, height: 768 });
});

test('imageSize returns null for truncated files', () => {
  assert.equal(v.imageSize(png(10, 10).subarray(0, 12)), null);
  assert.equal(v.imageSize(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
});
