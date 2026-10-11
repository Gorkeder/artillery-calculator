'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createRateLimiter, createUser, verifyPassword, sha256 } = require('../auth');

const GOOD = { login: 'newbie', email: 'newbie@example.com', password: 'longenough1', consent: true };

function register(s, over = {}) {
  return s.api('POST', '/api/register', { body: { ...GOOD, ...over } });
}

async function registerAndVerify(s, over = {}) {
  const creds = { ...GOOD, ...over };
  await register(s, over);
  const res = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  // Verification no longer opens a session: sign in explicitly, as a real user must.
  const login = await s.api('POST', '/api/login', { body: { login: creds.login, password: creds.password } });
  return { res, cookie: login.headers.get('set-cookie').split(';')[0] };
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

test('verify-email confirms once, does NOT open a session and the token cannot be reused', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const res = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  assert.equal(res.headers.get('set-cookie'), null, 'no session cookie');
  const u = s.db.prepare("SELECT email_verified_at FROM users WHERE login = 'newbie'").get();
  assert.ok(u.email_verified_at);
  const sessions = s.db
    .prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)')
    .get('newbie').n;
  assert.equal(sessions, 0);
  const again = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'token_invalid');
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie@example.com', password: 'longenough1' } });
  assert.equal(login.status, 200);
  const me = await s.api('GET', '/api/me', { cookie: login.headers.get('set-cookie').split(';')[0] });
  assert.equal(me.json.user.login, 'newbie');
  assert.deepEqual(me.json.can, { map: false, category: false, feature: false, marks: true, propose: true });
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
  const s = await startTestServer();
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

test('a taken login answers 409 identically whether or not the email is registered', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const withKnownEmail = await register(s, { login: 'newbie', email: 'newbie@example.com' });
  const withFreshEmail = await register(s, { login: 'newbie', email: 'fresh@example.com' });
  assert.equal(withKnownEmail.status, 409);
  assert.equal(withFreshEmail.status, 409);
  assert.equal(withKnownEmail.json.error, 'login_taken');
  assert.deepEqual(withKnownEmail.json, withFreshEmail.json);
  assert.equal(s.mailer.sent.length, 1);
});

test('taken logins do not burn the email budgets of the person registering', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  for (const login of ['taken1', 'taken2', 'taken3']) {
    createUser(s.db, { login, password: 'some-password-1', role: 'user', email: login + '@example.com' });
  }
  for (const login of ['taken1', 'taken2', 'taken3']) {
    const r = await register(s, { login, email: 'fresh@example.com' });
    assert.equal(r.status, 409, login);
    assert.equal(r.json.error, 'login_taken');
  }
  assert.equal(s.mailer.sent.length, 0);
  const ok = await register(s, { login: 'freelogin', email: 'fresh@example.com' });
  assert.equal(ok.status, 200);
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(s.mailer.sent[0].to, 'fresh@example.com');
});

test('an email held by a stale unverified account is taken over by the new registration', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const fresh = await register(s, { login: 'someone', email: 'someone@example.com' });
  await register(s); // L = newbie, unverified, email X = newbie@example.com
  const oldToken = s.lastToken('verify');
  const before = s.mailer.sent.length;
  const r = await register(s, { login: 'replacer', email: 'NewBie@example.com', password: 'replacer-pass-1' });
  assert.equal(r.status, fresh.status);
  assert.deepEqual(r.json, fresh.json);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 0, 'L is gone');
  const v = s.db.prepare("SELECT email, email_verified_at FROM users WHERE login = 'replacer'").get();
  assert.equal(v.email, 'newbie@example.com');
  assert.equal(v.email_verified_at, null);
  assert.equal(s.mailer.sent.length, before + 1, 'exactly one new mail');
  assert.equal(s.mailer.sent[before].to, 'newbie@example.com');
  assert.match(s.mailer.sent[before].text, /replacer/);
  const stale = await s.api('POST', '/api/verify-email', { body: { token: oldToken } });
  assert.equal(stale.status, 400);
  assert.equal(stale.json.error, 'token_invalid');
  const ok = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { ok: true });
  const login = await s.api('POST', '/api/login', { body: { login: 'replacer', password: 'replacer-pass-1' } });
  assert.equal(login.status, 200);
});

test('an email held by a verified account is never taken over', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  const before = s.mailer.sent.length;
  const r = await register(s, { login: 'replacer', email: 'newbie@example.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(s.mailer.sent.length, before, 'no mail');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 1, 'no deletion');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'replacer'").get().n, 0, 'nothing created');
});

test('an IP over its mail budget cannot burn a victim email budget', async (t) => {
  const charged = [];
  const spy = { allow: (key) => { charged.push(key); return true; } };
  const s = await startTestServer({
    limiters: { mailIp: createRateLimiter({ max: 1, windowMs: 60000 }), mailEmail: spy },
  });
  t.after(() => s.cleanup());
  const body = { email: 'victim@example.com' };
  assert.equal((await s.api('POST', '/api/resend-verification', { body })).status, 200);
  assert.equal((await s.api('POST', '/api/resend-verification', { body })).status, 429);
  assert.deepEqual(charged, ['victim@example.com']);
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
  const s2 = await startTestServer({ limiters: { mailEmail: createRateLimiter({ max: 100, windowMs: 60000 }) } });
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
  assert.equal((await s.api('POST', '/api/forgot-password', { body: { email: 'a@b.cc' } })).status, 503);
  assert.equal((await s.api('POST', '/api/resend-verification', { body: { email: 'a@b.cc' } })).status, 503);
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

test('forgot-password answers identically and mails only a known address', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  const before = s.mailer.sent.length;
  const known = await s.api('POST', '/api/forgot-password', { body: { email: 'NewBie@example.com' } });
  const unknown = await s.api('POST', '/api/forgot-password', { body: { email: 'ghost@example.com' } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  assert.equal(s.mailer.sent.length, before + 1);
  assert.match(s.mailer.sent[before].text, /#reset=[0-9a-f]{64}/);
});

test('reset-password sets a new password, closes every session and burns the token', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  const tooShort = await s.api('POST', '/api/reset-password', { body: { token, password: 'short' } });
  assert.equal(tooShort.json.error, 'password_short');
  assert.equal(tooShort.status, 400, 'a rejected password does not burn the token (next call succeeds)');
  const ok = await s.api('POST', '/api/reset-password', { body: { token, password: 'brand-new-pass' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('set-cookie'), null, 'reset does not log the user in');
  assert.equal((await s.api('GET', '/api/me', { cookie })).json.user, null);
  const reuse = await s.api('POST', '/api/reset-password', { body: { token, password: 'another-pass-1' } });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error, 'token_invalid');
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'brand-new-pass' } });
  assert.equal(login.status, 200);
});

test('reset-password refuses a password equal to the login without burning the token', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s, { login: 'longlogin1' });
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  const same = await s.api('POST', '/api/reset-password', { body: { token, password: 'LongLogin1' } });
  assert.equal(same.status, 400);
  assert.equal(same.json.error, 'password_equals_login');
  const ok = await s.api('POST', '/api/reset-password', { body: { token, password: 'fresh-password-1' } });
  assert.equal(ok.status, 200);
});

test('reset-password with a valid token marks an unverified address verified', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const r = await s.api('POST', '/api/reset-password', { body: { token: s.lastToken('reset'), password: 'fresh-password-1' } });
  assert.equal(r.status, 200);
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'fresh-password-1' } });
  assert.equal(login.status, 200);
});

test('reset-password rejects huge passwords and malformed tokens', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  const big = await s.api('POST', '/api/reset-password', { body: { token, password: 'p'.repeat(5000) } });
  assert.equal(big.json.error, 'password_long');
  for (const bad of [undefined, 7, { $ne: 1 }, 'nope']) {
    const r = await s.api('POST', '/api/reset-password', { body: { token: bad, password: 'fresh-password-1' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'token_invalid');
  }
  const ok = await s.api('POST', '/api/reset-password', { body: { token, password: 'fresh-password-1' } });
  assert.equal(ok.status, 200, 'rejected attempts did not burn the token');
});

test('a reset leaves the database consistent: new hash, no sessions, token used', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  const r = await s.api('POST', '/api/reset-password', { body: { token, password: 'brand-new-pass' } });
  assert.equal(r.status, 200);
  const u = s.db.prepare("SELECT id, password_hash FROM users WHERE login = 'newbie'").get();
  assert.equal(verifyPassword('brand-new-pass', u.password_hash), true);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(u.id).n, 0);
  assert.notEqual(s.db.prepare('SELECT used_at FROM auth_tokens WHERE token_hash = ?').get(sha256(token)).used_at, null);
});

test('reset-password and change-password are atomic when a step fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } }); // a second session
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  s.db.exec("CREATE TRIGGER boom BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const failed = await s.api('POST', '/api/reset-password', { body: { token, password: 'brand-new-pass' } });
  assert.equal(failed.status, 500);
  const hashOf = () => s.db.prepare("SELECT password_hash FROM users WHERE login = 'newbie'").get().password_hash;
  assert.equal(verifyPassword('longenough1', hashOf()), true, 'password unchanged');
  assert.equal(s.db.prepare('SELECT used_at FROM auth_tokens WHERE token_hash = ?').get(sha256(token)).used_at, null, 'token not burned');
  const change = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'new-password-1' } });
  assert.equal(change.status, 500);
  assert.equal(verifyPassword('longenough1', hashOf()), true, 'password unchanged by change-password');
  s.db.exec('DROP TRIGGER boom');
  const ok = await s.api('POST', '/api/reset-password', { body: { token, password: 'brand-new-pass' } });
  assert.equal(ok.status, 200);
});

test('change-password needs the current password and keeps only the current session', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  const second = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  const otherCookie = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await s.api('POST', '/api/change-password', { body: { current: 'longenough1', next: 'x' } })).status, 401);
  const wrong = await s.api('POST', '/api/change-password', { cookie, body: { current: 'wrong-wrong', next: 'new-password-1' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, 'current_password_wrong');
  const short = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'tiny' } });
  assert.equal(short.json.error, 'password_short');
  const huge = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'p'.repeat(5000) } });
  assert.equal(huge.json.error, 'password_long');
  const ok = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'new-password-1' } });
  assert.equal(ok.status, 200);
  assert.equal((await s.api('GET', '/api/me', { cookie })).json.user.login, 'newbie');
  assert.equal((await s.api('GET', '/api/me', { cookie: otherCookie })).json.user, null);
  assert.equal((await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } })).status, 401);
  assert.equal((await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'new-password-1' } })).status, 200);
});

test('sessions: list marks the current one, single and bulk revoke work', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  const other = await s.api('POST', '/api/login', {
    body: { login: 'newbie', password: 'longenough1' },
    headers: { 'user-agent': 'Phone/2' },
  });
  const otherCookie = other.headers.get('set-cookie').split(';')[0];
  const list = await s.api('GET', '/api/sessions', { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.json.sessions.length, 2);
  const current = list.json.sessions.filter((x) => x.current);
  assert.equal(current.length, 1);
  const phone = list.json.sessions.find((x) => x.userAgent === 'Phone/2');
  assert.match(phone.id, /^[0-9a-f]{16}$/);
  assert.equal(phone.current, false);

  const del = await s.api('DELETE', '/api/sessions/' + phone.id, { cookie });
  assert.equal(del.status, 200);
  assert.equal((await s.api('GET', '/api/me', { cookie: otherCookie })).json.user, null);
  assert.equal((await s.api('DELETE', '/api/sessions/' + phone.id, { cookie })).status, 404);
  assert.equal((await s.api('DELETE', '/api/sessions/not-an-id', { cookie })).status, 400);

  const third = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  const thirdCookie = third.headers.get('set-cookie').split(';')[0];
  const bulk = await s.api('POST', '/api/sessions/revoke-others', { cookie });
  assert.equal(bulk.status, 200);
  assert.equal((await s.api('GET', '/api/me', { cookie: thirdCookie })).json.user, null);
  assert.equal((await s.api('GET', '/api/me', { cookie })).json.user.login, 'newbie');
});

test("a user cannot revoke another user's session", async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  createUser(s.db, { login: 'victim', password: 'victim-pass-1', role: 'user', email: 'v@example.com' });
  const v = await s.api('POST', '/api/login', { body: { login: 'victim', password: 'victim-pass-1' } });
  const vCookie = v.headers.get('set-cookie').split(';')[0];
  const vList = await s.api('GET', '/api/sessions', { cookie: vCookie });
  const victimSessionId = vList.json.sessions[0].id;
  const r = await s.api('DELETE', '/api/sessions/' + victimSessionId, { cookie });
  assert.equal(r.status, 404);
  assert.equal((await s.api('GET', '/api/me', { cookie: vCookie })).json.user.login, 'victim');
});

test('sessions endpoints require a login', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  assert.equal((await s.api('GET', '/api/sessions')).status, 401);
  assert.equal((await s.api('POST', '/api/sessions/revoke-others')).status, 401);
  assert.equal((await s.api('POST', '/api/change-password', { body: {} })).status, 401);
});
