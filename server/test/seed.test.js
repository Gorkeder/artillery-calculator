'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../db');
const { extractDataUri, seedMap } = require('../seed');
const { createUser } = require('../auth');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9),
  ]);
const asMapJs = (buf) => `window.__ARTY_MAP__ = "data:image/png;base64,${buf.toString('base64')}";\n`;

test('extractDataUri decodes the base64 image from map.js text', () => {
  const buf = png(12, 34);
  const r = extractDataUri(asMapJs(buf));
  assert.equal(r.type, 'png');
  assert.ok(r.buf.equals(buf));
});

test('extractDataUri throws when there is no image', () => {
  assert.throws(() => extractDataUri('window.x = 1;'));
});

test('seedMap writes the file and creates a published map with its size', () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-seed-'));
  try {
    const id = seedMap(db, dir, { slug: 'main', title: 'Основная', text: asMapJs(png(800, 600)) });
    const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
    assert.equal(row.slug, 'main');
    assert.equal(row.width, 800);
    assert.equal(row.height, 600);
    assert.equal(row.published, 1);
    assert.ok(fs.existsSync(path.join(dir, row.image_path)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seedMap rejects data that is not a real image', () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-seed-'));
  try {
    const fake = `x = "data:image/png;base64,${Buffer.from('not an image').toString('base64')}"`;
    assert.throws(() => seedMap(db, dir, { slug: 'main', title: 'M', text: fake }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maps').get().n, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createUser used by the CLI makes an admin that can be found by login', () => {
  const db = openDb(':memory:');
  createUser(db, { login: 'root_admin', password: 'a-long-password', role: 'admin' });
  assert.equal(db.prepare("SELECT role FROM users WHERE login = 'root_admin'").get().role, 'admin');
});
