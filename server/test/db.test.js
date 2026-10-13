'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, SCHEMA, migrate } = require('../db');
const { DatabaseSync } = require('node:sqlite');

test('openDb creates all tables', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of ['users', 'sessions', 'maps', 'categories', 'features', 'feature_images', 'auth_tokens']) {
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

test('migration v2 upgrades a v1 database and keeps the admin verified', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (login, password_hash, role) VALUES ('admin', 'h', 'admin')").run();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t', 1, 99)").run();
  migrate(db);
  const u = db.prepare('SELECT email, email_verified_at, created_at FROM users').get();
  assert.equal(u.email, null);
  assert.equal(u.email_verified_at, u.created_at);
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 6);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'auth_tokens'").get());
  const s = db.prepare('SELECT created_at, last_seen_at, ip, user_agent FROM sessions').get();
  assert.equal(s.created_at, 0);
  assert.equal(s.ip, null);
  migrate(db); // second run is a no-op
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('logins and emails are unique case-insensitively', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (login, password_hash, email) VALUES ('Anna', 'h', 'a@x.io')").run();
  assert.throws(() => db.prepare("INSERT INTO users (login, password_hash) VALUES ('anna', 'h')").run());
  assert.throws(() => db.prepare("INSERT INTO users (login, password_hash, email) VALUES ('bob', 'h', 'A@X.IO')").run());
  db.prepare("INSERT INTO users (login, password_hash) VALUES ('c1', 'h')").run();
  db.prepare("INSERT INTO users (login, password_hash) VALUES ('c2', 'h')").run(); // NULL emails may repeat
});

test('deleting a user cascades to auth_tokens', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (login, password_hash) VALUES ('u1', 'h')").run();
  db.prepare("INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES ('x', 1, 'verify_email', 1)").run();
  db.prepare('DELETE FROM users WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
});
