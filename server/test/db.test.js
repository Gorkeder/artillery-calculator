'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');

test('openDb creates all tables', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of ['users', 'sessions', 'maps', 'categories', 'features', 'feature_images']) {
    assert.ok(names.includes(t), 'missing table ' + t);
  }
});

test('deleting a map cascades to categories, features and feature images', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO maps (slug, title) VALUES ('a', 'A')").run();
  db.prepare("INSERT INTO categories (map_id, name) VALUES (1, 'c')").run();
  db.prepare("INSERT INTO features (map_id, category_id, geometry) VALUES (1, 1, '{}')").run();
  db.prepare("INSERT INTO feature_images (feature_id, path) VALUES (1, 'x.png')").run();
  db.prepare('DELETE FROM maps WHERE id = 1').run();
  for (const t of ['categories', 'features', 'feature_images']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});

test('features.status only accepts approved or pending', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO maps (slug, title) VALUES ('a', 'A')").run();
  db.prepare("INSERT INTO categories (map_id, name) VALUES (1, 'c')").run();
  assert.throws(() =>
    db
      .prepare("INSERT INTO features (map_id, category_id, geometry, status) VALUES (1, 1, '{}', 'bogus')")
      .run(),
  );
});

test('users.role only accepts admin or user', () => {
  const db = openDb(':memory:');
  assert.throws(() =>
    db.prepare("INSERT INTO users (login, password_hash, role) VALUES ('a', 'h', 'root')").run(),
  );
});
