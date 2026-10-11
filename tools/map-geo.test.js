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
