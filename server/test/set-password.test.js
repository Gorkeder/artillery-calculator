'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createUser, createSession, getSessionUser, setPassword, verifyPassword } = require('../auth');

test('setPassword replaces the hash and closes the user sessions', () => {
  const db = openDb(':memory:');
  const uid = createUser(db, { login: 'admin', password: 'old-password-1', role: 'admin' });
  const token = createSession(db, uid, 1000);
  setPassword(db, 'ADMIN', 'new-password-1');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid);
  assert.equal(verifyPassword('new-password-1', row.password_hash), true);
  assert.equal(verifyPassword('old-password-1', row.password_hash), false);
  assert.equal(getSessionUser(db, token, 2000), null);
  assert.throws(() => setPassword(db, 'ghost', 'new-password-1'), /not found/);
  assert.throws(() => setPassword(db, 'admin', 'short'), /at least 8/);
});
