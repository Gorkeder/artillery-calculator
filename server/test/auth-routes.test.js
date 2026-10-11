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

test('login accepts the email instead of the login, ignoring case and spaces', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'Visitor', password: 'visitor-pass', role: 'user', email: 'visitor@example.com' });
  const byEmail = await s.api('POST', '/api/login', { body: { login: ' Visitor@Example.COM ', password: 'visitor-pass' } });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.json.user.login, 'Visitor');
  const byLogin = await s.api('POST', '/api/login', { body: { login: 'VISITOR', password: 'visitor-pass' } });
  assert.equal(byLogin.status, 200);
  assert.equal(byLogin.json.user.email, 'visitor@example.com');
  assert.equal(byLogin.json.user.emailVerified, true);
});

test('an @ identifier that is not a valid email is treated as an unknown account', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  // createUser (CLI path) does not validate emails, so a row with a non-normalizable address can exist.
  createUser(s.db, { login: 'oddball', password: 'oddball-pass', role: 'user', email: 'odd@localhost' });
  const unknown = await s.api('POST', '/api/login', { body: { login: 'ghost@example.com', password: 'oddball-pass' } });
  assert.equal(unknown.status, 401);
  for (const ident of ['odd@localhost', 'a@@b', '@']) {
    const r = await s.api('POST', '/api/login', { body: { login: ident, password: 'oddball-pass' } });
    assert.equal(r.status, 401, ident);
    assert.deepEqual(r.json, unknown.json);
    assert.equal(r.headers.get('set-cookie'), null);
  }
});

test('the per-account limiter key of an email identifier is the normalized email', async (t) => {
  const keys = [];
  const s = await startTestServer({ limiters: { loginAccount: { allow: (key) => { keys.push(key); return true; } } } });
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'Visitor', password: 'visitor-pass', role: 'user', email: 'visitor@example.com' });
  const r = await s.api('POST', '/api/login', { body: { login: ' Visitor@Example.COM ', password: 'visitor-pass' } });
  assert.equal(r.status, 200);
  assert.deepEqual(keys, ['acct:visitor@example.com']);
});

test('an unverified account gets email_not_verified only with the right password', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'pending', password: 'pending-pass', role: 'user', email: 'p@example.com', emailVerified: false });
  const right = await s.api('POST', '/api/login', { body: { login: 'pending', password: 'pending-pass' } });
  assert.equal(right.status, 403);
  assert.equal(right.json.error, 'email_not_verified');
  assert.equal(right.headers.get('set-cookie'), null);
  const wrong = await s.api('POST', '/api/login', { body: { login: 'pending', password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, 'invalid login or password');
});

test('login is also rate limited per account across different IPs', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  for (let i = 0; i < 10; i++) {
    const r = await s.api('POST', '/api/login', {
      body: { login: 'admin', password: 'bad' + i },
      headers: { 'x-forwarded-for': `10.0.0.${i + 1}` },
    });
    assert.equal(r.status, 401);
  }
  const blocked = await s.api('POST', '/api/login', {
    body: { login: 'admin', password: 'correct horse' },
    headers: { 'x-forwarded-for': '10.0.0.99' },
  });
  assert.equal(blocked.status, 429);
});

test('login stores the client IP and user agent on the session', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await s.api('POST', '/api/login', {
    body: { login: 'admin', password: 'correct horse' },
    headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'TestAgent/1.0' },
  });
  const row = s.db.prepare('SELECT ip, user_agent FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
  assert.equal(row.ip, '203.0.113.7');
  assert.equal(row.user_agent, 'TestAgent/1.0');
});
