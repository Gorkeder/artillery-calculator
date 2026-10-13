'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../map-geo');

const size = { width: 2000, height: 1000 };

test('toLatLng maps image top-left to the top of the Leaflet plane and bottom-right to lng=width', () => {
  assert.deepEqual(Geo.toLatLng({ x: 0, y: 0 }, size), [1000, 0]);
  assert.deepEqual(Geo.toLatLng({ x: 1, y: 1 }, size), [0, 2000]);
  assert.deepEqual(Geo.toLatLng({ x: 0.5, y: 0.25 }, size), [750, 1000]);
});

test('fromLatLng is the inverse of toLatLng', () => {
  const p = Geo.fromLatLng(Geo.toLatLng({ x: 0.3, y: 0.7 }, size), size);
  assert.ok(Math.abs(p.x - 0.3) < 1e-9);
  assert.ok(Math.abs(p.y - 0.7) < 1e-9);
});

test('fromLatLng accepts {lat,lng} and clamps points outside the image', () => {
  assert.deepEqual(Geo.fromLatLng({ lat: 2000, lng: -50 }, size), { x: 0, y: 0 });
  assert.deepEqual(Geo.fromLatLng({ lat: -10, lng: 99999 }, size), { x: 1, y: 1 });
});

test('pointsToLatLngs / latLngsToPoints round-trip a polygon', () => {
  const pts = [[0.1, 0.2], [0.9, 0.2], [0.5, 0.8]];
  const back = Geo.latLngsToPoints(Geo.pointsToLatLngs(pts, size), size);
  back.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-9);
    assert.ok(Math.abs(p[1] - pts[i][1]) < 1e-9);
  });
});

test('featureStyle prefers the feature colour and falls back to the category colour', () => {
  const cat = { color: '#d4c24f' };
  assert.equal(Geo.featureStyle({ color: null, opacity: null }, cat).color, '#d4c24f');
  assert.equal(Geo.featureStyle({ color: '#112233', opacity: null }, cat).fillColor, '#112233');
});

test('featureStyle uses 0.25 fill opacity by default and honours explicit values including 0', () => {
  const cat = { color: '#d4c24f' };
  assert.equal(Geo.featureStyle({ color: null, opacity: null }, cat).fillOpacity, 0.25);
  assert.equal(Geo.featureStyle({ color: null, opacity: 0 }, cat).fillOpacity, 0);
  assert.equal(Geo.featureStyle({ color: null, opacity: 0.7 }, cat).fillOpacity, 0.7);
});

test('simplify keeps the ends and drops points on a straight line', () => {
  const line = Array.from({ length: 11 }, (_, i) => [i / 10, 0.5]);
  assert.deepEqual(Geo.simplify(line, 0.001), [[0, 0.5], [1, 0.5]]);
});

test('simplify keeps a real corner and never returns fewer than 2 points', () => {
  const corner = [[0, 0], [0.5, 0.5], [1, 0]];
  assert.deepEqual(Geo.simplify(corner, 0.01), corner);
  assert.deepEqual(Geo.simplify([[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]], 0.01).length, 2);
  assert.deepEqual(Geo.simplify([[0.3, 0.3]], 0.01), [[0.3, 0.3]]);
});

test('simplify shrinks a dense wiggly stroke below the server limit', () => {
  const stroke = Array.from({ length: 5000 }, (_, i) => [i / 5000, 0.5 + 0.001 * Math.sin(i / 3)]);
  const out = Geo.simplify(stroke, 0.0005);
  assert.ok(out.length < 2000 && out.length >= 2);
  assert.deepEqual(out[0], stroke[0]);
  assert.deepEqual(out[out.length - 1], stroke[stroke.length - 1]);
});
