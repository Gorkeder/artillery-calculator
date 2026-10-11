'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createUser, createSession, getSessionUser, setPassword, verifyPassword } = require('../auth');
const { issueToken, peekToken } = require('../tokens');

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

test('setPassword verifies the address and purges outstanding tokens in one go', () => {
  const db = openDb(':memory:');
  const uid = createUser(db, { login: 'admin', password: 'old-password-1', role: 'admin', email: 'a@example.com', emailVerified: false });
  const reset = issueToken(db, uid, 'reset_password', Date.now());
  issueToken(db, uid, 'verify_email', Date.now());
  setPassword(db, 'admin', 'new-password-1');
  const row = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(uid);
  assert.notEqual(row.email_verified_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ?').get(uid).n, 0);
  assert.equal(peekToken(db, reset, 'reset_password', Date.now()), null);
});

test('setPassword rolls back everything when a step fails', () => {
  const db = openDb(':memory:');
  const uid = createUser(db, { login: 'admin', password: 'old-password-1', role: 'admin', emailVerified: false });
  const token = createSession(db, uid, 1000);
  db.exec("CREATE TRIGGER boom BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'boom'); END");
  assert.throws(() => setPassword(db, 'admin', 'new-password-1'), /boom/);
  const row = db.prepare('SELECT password_hash, email_verified_at FROM users WHERE id = ?').get(uid);
  assert.equal(verifyPassword('old-password-1', row.password_hash), true);
  assert.equal(row.email_verified_at, null);
  assert.equal(getSessionUser(db, token, 2000).login, 'admin');
  db.exec('DROP TRIGGER boom');
  setPassword(db, 'admin', 'new-password-1');
});
