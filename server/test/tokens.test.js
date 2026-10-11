'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createUser } = require('../auth');
const { issueToken, peekToken, consumeToken, revokeTokens, cleanup } = require('../tokens');

const H = 60 * 60 * 1000;

function setup() {
  const db = openDb(':memory:');
  const uid = createUser(db, { login: 'tok1', password: 'password-1', role: 'user', email: 't@x.io', emailVerified: false });
  return { db, uid };
}

test('a token works once and only for its kind', () => {
  const { db, uid } = setup();
  const t = issueToken(db, uid, 'verify_email', 1000);
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE token_hash = ?').get(t).n, 0, 'raw token is not stored');
  assert.equal(consumeToken(db, t, 'reset_password', 2000), null);
  assert.equal(peekToken(db, t, 'verify_email', 2000), uid);
  assert.equal(consumeToken(db, t, 'verify_email', 2000), uid);
  assert.equal(consumeToken(db, t, 'verify_email', 2000), null);
  assert.equal(peekToken(db, t, 'verify_email', 2000), null);
});

test('tokens expire: 24 h for verification, 1 h for reset', () => {
  const { db, uid } = setup();
  const v = issueToken(db, uid, 'verify_email', 0);
  const r = issueToken(db, uid, 'reset_password', 0);
  assert.equal(peekToken(db, v, 'verify_email', 23 * H), uid);
  assert.equal(peekToken(db, v, 'verify_email', 25 * H), null);
  assert.equal(peekToken(db, r, 'reset_password', 30 * 60 * 1000), uid);
  assert.equal(peekToken(db, r, 'reset_password', 2 * H), null);
});

test('issuing a new token revokes the previous one of the same kind', () => {
  const { db, uid } = setup();
  const first = issueToken(db, uid, 'verify_email', 0);
  const second = issueToken(db, uid, 'verify_email', 1);
  assert.equal(consumeToken(db, first, 'verify_email', 2), null);
  assert.equal(consumeToken(db, second, 'verify_email', 2), uid);
});

test('revokeTokens kills every open token of a kind', () => {
  const { db, uid } = setup();
  const t = issueToken(db, uid, 'reset_password', 0);
  revokeTokens(db, uid, 'reset_password', 1);
  assert.equal(consumeToken(db, t, 'reset_password', 2), null);
});

test('malformed tokens are rejected without touching the database', () => {
  const { db } = setup();
  for (const bad of [undefined, null, 5, {}, [], '', 'abc', 'G'.repeat(64), 'A'.repeat(64)]) {
    assert.equal(consumeToken(db, bad, 'verify_email', 0), null, String(bad));
    assert.equal(peekToken(db, bad, 'verify_email', 0), null, String(bad));
  }
});

test('cleanup drops stale tokens and unverified accounts, keeps live ones', () => {
  const { db, uid } = setup(); // unverified, created "now" (real clock)
  const real = Date.now();
  issueToken(db, uid, 'verify_email', real);
  const keeper = createUser(db, { login: 'keeper', password: 'password-1', role: 'user', email: 'k@x.io' });
  // 1 hour later: everything is still alive
  cleanup(db, real + 1 * H);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid));
  // 3 days later: the unverified account and its expired token are gone, the verified one stays
  cleanup(db, real + 72 * H);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid), undefined);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(keeper));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
});

test('cleanup keeps an unverified account while its verification token is alive', () => {
  const { db, uid } = setup();
  const real = Date.now();
  issueToken(db, uid, 'verify_email', real + 40 * H); // re-sent later, still valid at real + 50h
  cleanup(db, real + 50 * H);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid));
});
