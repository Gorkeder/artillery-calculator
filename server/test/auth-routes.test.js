'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createRateLimiter, createUser } = require('../auth');

test('GET /api/me is anonymous without a cookie', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('GET', '/api/me');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { user: null, can: { map: false, category: false, feature: false } });
});

test('login sets a hardened session cookie and /me reports admin capabilities', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('POST', '/api/login', { body: { login: 'admin', password: 'correct horse' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'admin');
  const setCookie = r.headers.get('set-cookie');
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Max-Age=2592000']) assert.ok(setCookie.includes(part), part);
  const cookie = setCookie.split(';')[0];
  const me = await s.api('GET', '/api/me', { cookie });
  assert.equal(me.json.user.login, 'admin');
  assert.deepEqual(me.json.can, { map: true, category: true, feature: true });
});

test('wrong password and unknown login both give 401 with the same message', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const a = await s.api('POST', '/api/login', { body: { login: 'admin', password: 'nope' } });
  const b = await s.api('POST', '/api/login', { body: { login: 'ghost', password: 'nope' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  assert.equal(a.headers.get('set-cookie'), null);
});

test('login rejects non-string credentials', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('POST', '/api/login', { body: { login: { $ne: 1 }, password: 12345 } });
  assert.equal(r.status, 401);
});

test('login is rate limited per IP', async (t) => {
  const s = await startTestServer({ loginLimiter: createRateLimiter({ max: 3, windowMs: 60000 }) });
  t.after(() => s.cleanup());
  for (let i = 0; i < 3; i++) {
    assert.equal((await s.api('POST', '/api/login', { body: { login: 'admin', password: 'bad' + i } })).status, 401);
  }
  const blocked = await s.api('POST', '/api/login', { body: { login: 'admin', password: 'correct horse' } });
  assert.equal(blocked.status, 429);
});

test('login without X-Requested-With is rejected before any auth work', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const res = await fetch(s.base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'correct horse' }),
  });
  assert.equal(res.status, 403);
});

test('logout invalidates the session server-side', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const out = await s.api('POST', '/api/logout', { cookie: s.adminCookie });
  assert.equal(out.json.user, null);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  const me = await s.api('GET', '/api/me', { cookie: s.adminCookie });
  assert.equal(me.json.user, null);
});

test('expired sessions stop working', async (t) => {
  const s = await startTestServer({ now: 1_000_000 });
  t.after(() => s.cleanup());
  assert.equal((await s.api('GET', '/api/me', { cookie: s.adminCookie })).json.user.login, 'admin');
  s.setNow(1_000_000 + 31 * 24 * 60 * 60 * 1000);
  assert.equal((await s.api('GET', '/api/me', { cookie: s.adminCookie })).json.user, null);
});

test('a normal user can log in but has no write capabilities', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'visitor', password: 'visitor-pass', role: 'user' });
  const r = await s.api('POST', '/api/login', { body: { login: 'visitor', password: 'visitor-pass' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.can, { map: false, category: false, feature: false });
});
