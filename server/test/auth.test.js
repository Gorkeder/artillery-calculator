'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const a = require('../auth');

test('hashPassword/verifyPassword round-trip and reject wrong password', () => {
  const stored = a.hashPassword('correct horse');
  assert.ok(stored.startsWith('scrypt$'));
  assert.equal(a.verifyPassword('correct horse', stored), true);
  assert.equal(a.verifyPassword('wrong', stored), false);
  assert.equal(a.verifyPassword('x', 'garbage'), false);
});

test('hashPassword uses a fresh salt each time', () => {
  assert.notEqual(a.hashPassword('same-password'), a.hashPassword('same-password'));
});

test('createUser validates login and password and stores a hash', () => {
  const db = openDb(':memory:');
  assert.throws(() => a.createUser(db, { login: 'a', password: 'longenough', role: 'admin' }));
  assert.throws(() => a.createUser(db, { login: 'admin', password: 'short', role: 'admin' }));
  assert.throws(() => a.createUser(db, { login: 'admin', password: 'longenough', role: 'root' }));
  const id = a.createUser(db, { login: 'admin', password: 'longenough', role: 'admin' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.equal(row.role, 'admin');
  assert.notEqual(row.password_hash, 'longenough');
});

test('sessions: valid token resolves user, token is stored hashed, expiry and destroy invalidate', () => {
  const db = openDb(':memory:');
  const uid = a.createUser(db, { login: 'admin', password: 'longenough', role: 'admin' });
  const token = a.createSession(db, uid, 1000, 5000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
  assert.deepEqual({ ...a.getSessionUser(db, token, 2000) }, { id: uid, login: 'admin', role: 'admin', proposalsBlocked: false });
  assert.equal(a.getSessionUser(db, token, 6000), null);
  const t2 = a.createSession(db, uid, 1000, 5000);
  a.destroySession(db, t2);
  assert.equal(a.getSessionUser(db, t2, 2000), null);
  assert.equal(a.getSessionUser(db, null, 2000), null);
  assert.equal(a.getSessionUser(db, 'nonsense', 2000), null);
});

test('deleting a user invalidates their sessions', () => {
  const db = openDb(':memory:');
  const uid = a.createUser(db, { login: 'bob_user', password: 'longenough', role: 'user' });
  const token = a.createSession(db, uid, 0);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  assert.equal(a.getSessionUser(db, token, 1), null);
});

test('parseCookies handles multiple cookies, spaces and bad escapes', () => {
  assert.deepEqual(a.parseCookies('a=1; sid=abc; b=%20x'), { a: '1', sid: 'abc', b: ' x' });
  assert.deepEqual(a.parseCookies(undefined), {});
  assert.deepEqual(a.parseCookies('bad=%E0%A4%A; ok=1'), { ok: '1' });
});

test('sessionCookie has HttpOnly, SameSite=Strict, 30-day Max-Age; Secure is optional', () => {
  const c = a.sessionCookie('tok', { secure: true });
  assert.match(c, /^sid=tok; /);
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Max-Age=2592000', 'Path=/', 'Secure']) assert.ok(c.includes(part), part);
  assert.ok(!a.sessionCookie('tok', { secure: false }).includes('Secure'));
  assert.match(a.clearCookie({ secure: true }), /Max-Age=0/);
});

test('rate limiter blocks after max hits inside the window and recovers', () => {
  const rl = a.createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(rl.allow('ip', 0), true);
  assert.equal(rl.allow('ip', 10), true);
  assert.equal(rl.allow('ip', 20), false);
  assert.equal(rl.allow('other', 20), true);
  assert.equal(rl.allow('ip', 1500), true);
});

test('createUser stores a lower-cased email and marks it verified unless told otherwise', () => {
  const db = openDb(':memory:');
  const id1 = a.createUser(db, { login: 'mail1', password: 'password-1', role: 'user', email: 'Mail1@Example.COM' });
  const id2 = a.createUser(db, { login: 'mail2', password: 'password-2', role: 'user', email: 'mail2@example.com', emailVerified: false });
  const r1 = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(id1);
  const r2 = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(id2);
  assert.equal(r1.email, 'mail1@example.com');
  assert.ok(r1.email_verified_at);
  assert.equal(r2.email_verified_at, null);
});

test('createSession records meta; touchSession updates last_seen_at at most every 10 minutes', () => {
  const db = openDb(':memory:');
  const uid = a.createUser(db, { login: 'sess', password: 'password-1', role: 'user' });
  const token = a.createSession(db, uid, 1_000, undefined, { ip: '1.2.3.4', userAgent: 'UA/1' });
  const row = () => db.prepare('SELECT created_at, last_seen_at, ip, user_agent FROM sessions').get();
  assert.equal(row().created_at, 1_000);
  assert.equal(row().ip, '1.2.3.4');
  assert.equal(row().user_agent, 'UA/1');
  a.touchSession(db, token, 1_000 + 5 * 60 * 1000);
  assert.equal(row().last_seen_at, 1_000);
  a.touchSession(db, token, 1_000 + 11 * 60 * 1000);
  assert.equal(row().last_seen_at, 1_000 + 11 * 60 * 1000);
  assert.equal(a.sessionId(token).length, 16);
  assert.equal(a.sessionId(token), a.sha256(token).slice(0, 16));
});
