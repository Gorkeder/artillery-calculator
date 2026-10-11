'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createRateLimiter } = require('../auth');

const GOOD = { login: 'newbie', email: 'newbie@example.com', password: 'longenough1', consent: true };

function register(s, over = {}) {
  return s.api('POST', '/api/register', { body: { ...GOOD, ...over } });
}

async function registerAndVerify(s, over = {}) {
  await register(s, over);
  const res = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  return { res, cookie: res.headers.get('set-cookie').split(';')[0] };
}

test('register creates an unverified user and mails a verification link', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await register(s);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const u = s.db.prepare("SELECT login, email, email_verified_at, role FROM users WHERE login = 'newbie'").get();
  assert.equal(u.email, 'newbie@example.com');
  assert.equal(u.email_verified_at, null);
  assert.equal(u.role, 'user');
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(s.mailer.sent[0].to, 'newbie@example.com');
  assert.match(s.mailer.sent[0].text, /https:\/\/test\.local\/account#verify=[0-9a-f]{64}/);
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  assert.equal(login.status, 403);
  assert.equal(login.json.error, 'email_not_verified');
});

test('verify-email confirms once, opens a session and the token cannot be reused', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { res, cookie } = await registerAndVerify(s);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.login, 'newbie');
  assert.equal(res.json.user.emailVerified, true);
  const me = await s.api('GET', '/api/me', { cookie });
  assert.equal(me.json.user.login, 'newbie');
  assert.deepEqual(me.json.can, { map: false, category: false, feature: false });
  const again = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'token_invalid');
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie@example.com', password: 'longenough1' } });
  assert.equal(login.status, 200);
});

test('an expired verification token is refused', async (t) => {
  const s = await startTestServer({ now: 1_000_000 });
  t.after(() => s.cleanup());
  await register(s);
  s.setNow(1_000_000 + 25 * 60 * 60 * 1000);
  const r = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(r.status, 400);
});

test('validation errors carry stable codes', async (t) => {
  const s = await startTestServer({ limiters: { registerIp: createRateLimiter({ max: 100, windowMs: 60000 }) } });
  t.after(() => s.cleanup());
  const cases = [
    [{ login: 'ab' }, 'login_invalid'],
    [{ login: 'Admin' }, 'login_reserved'],
    [{ email: 'not-an-email' }, 'email_invalid'],
    [{ password: 'short' }, 'password_short'],
    [{ password: 'x'.repeat(5000) }, 'password_long'],
    [{ consent: false }, 'consent_required'],
    [{ consent: undefined }, 'consent_required'],
  ];
  for (const [over, code] of cases) {
    const r = await register(s, over);
    assert.equal(r.status, 400, JSON.stringify(over).slice(0, 60));
    assert.equal(r.json.error, code);
  }
  const eq = await register(s, { login: 'samename', password: 'SameName' });
  assert.equal(eq.json.error, 'password_equals_login');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'only the seeded admin exists');
  assert.equal(s.mailer.sent.length, 0);
});

test('non-object field types do not crash registration', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('POST', '/api/register', {
    body: { login: { $ne: 1 }, email: ['a@b.cc'], password: 123456789, consent: 'yes', website: 5 },
  });
  assert.equal(r.status, 400);
});

test('a taken login (any case) is reported; a taken email is not revealed', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  const dupLogin = await register(s, { login: 'NEWBIE', email: 'other@example.com' });
  assert.equal(dupLogin.status, 409);
  assert.equal(dupLogin.json.error, 'login_taken');
  const before = s.mailer.sent.length;
  const dupEmail = await register(s, { login: 'another', email: ' NewBie@Example.com ' });
  assert.equal(dupEmail.status, 200);
  assert.deepEqual(dupEmail.json, { ok: true });
  assert.equal(s.mailer.sent.length, before, 'verified owner is not spammed');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'another'").get().n, 0);
});

test('registering again with the email of an unverified account re-sends the link', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const first = s.lastToken('verify');
  const r = await register(s, { login: 'newbie' });
  assert.equal(r.status, 200);
  assert.equal(s.mailer.sent.length, 2);
  assert.notEqual(s.lastToken('verify'), first);
  assert.equal((await s.api('POST', '/api/verify-email', { body: { token: first } })).status, 400);
});

test('the honeypot field silently swallows bot registrations', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await register(s, { website: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 0);
  assert.equal(s.mailer.sent.length, 0);
});

test('registration is rate limited per IP and per email', async (t) => {
  const s = await startTestServer({ limiters: { registerIp: createRateLimiter({ max: 2, windowMs: 60000 }) } });
  t.after(() => s.cleanup());
  assert.equal((await register(s, { login: 'user1', email: 'user1@example.com' })).status, 200);
  assert.equal((await register(s, { login: 'user2', email: 'user2@example.com' })).status, 200);
  assert.equal((await register(s, { login: 'user3', email: 'user3@example.com' })).status, 429);
  const s2 = await startTestServer();
  t.after(() => s2.cleanup());
  for (let i = 0; i < 3; i++) {
    assert.equal((await register(s2, { login: 'same' + i, email: 'same@example.com' })).status, 200);
  }
  assert.equal((await register(s2, { login: 'same9', email: 'same@example.com' })).status, 429);
});

test('without a configured mailer registration answers 503 and creates nothing', async (t) => {
  const s = await startTestServer({ noMailer: true });
  t.after(() => s.cleanup());
  const r = await register(s);
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'mail_not_configured');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 0);
});

test('a failing mailer does not break registration or leak a rejection', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = { configured: true, send: async () => { throw new Error('smtp down'); } };
  const s = await startTestServer({ mailer: failing });
  t.after(() => s.cleanup());
  const r = await register(s);
  assert.equal(r.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 1);
});

test('resend-verification gives the same answer for known and unknown addresses', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const known = await s.api('POST', '/api/resend-verification', { body: { email: 'newbie@example.com' } });
  const unknown = await s.api('POST', '/api/resend-verification', { body: { email: 'ghost@example.com' } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  assert.equal(s.mailer.sent.length, 2, 'only the real unverified address got a second mail');
  assert.equal(s.mailer.sent[1].to, 'newbie@example.com');
});

test('verify-email rejects malformed tokens without crashing', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  for (const token of [undefined, null, 5, { $ne: 1 }, [], '', 'short', 'A'.repeat(64), 'z'.repeat(64)]) {
    const r = await s.api('POST', '/api/verify-email', { body: { token } });
    assert.equal(r.status, 400, JSON.stringify(token));
    assert.equal(r.json.error, 'token_invalid');
  }
});

test('a normal verified user still cannot write to the map', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  const r = await s.api('POST', '/api/maps', { cookie, body: { slug: 'x', title: 'X' } });
  assert.equal(r.status, 403);
});
