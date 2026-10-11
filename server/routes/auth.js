'use strict';

const { HttpError, readJson } = require('../http-util');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  clearCookie,
} = require('../auth');
const { meBody } = require('../me');

// Verified against when the login does not exist, so both failure paths cost the same time.
const DUMMY_HASH = hashPassword('timing-equalizer-password');

const BY_LOGIN = 'SELECT id, login, role, password_hash, email_verified_at FROM users WHERE lower(login) = lower(?)';
const BY_EMAIL = 'SELECT id, login, role, password_hash, email_verified_at FROM users WHERE lower(email) = lower(?)';

module.exports = [
  { method: 'GET', pattern: '/api/me', handler: async (c) => ({ body: meBody(c.db, c.user) }) },
  {
    method: 'POST',
    pattern: '/api/login',
    handler: async (c) => {
      const now = c.now();
      if (!c.limiters.login.allow(c.ip, now)) throw new HttpError(429, 'too many attempts, try again later');
      const body = await readJson(c.req);
      const ident = (typeof body.login === 'string' ? body.login : '').trim().slice(0, 254);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!c.limiters.loginAccount.allow('acct:' + ident.toLowerCase(), now)) {
        throw new HttpError(429, 'too many attempts, try again later');
      }
      const row = c.db.prepare(ident.includes('@') ? BY_EMAIL : BY_LOGIN).get(ident);
      const good = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
      if (!row || !good) throw new HttpError(401, 'invalid login or password');
      if (!row.email_verified_at) throw new HttpError(403, 'email_not_verified');
      const token = createSession(c.db, row.id, now, undefined, c.clientMeta);
      c.headers['Set-Cookie'] = sessionCookie(token, { secure: c.cookieSecure });
      return { body: meBody(c.db, row) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/logout',
    handler: async (c) => {
      if (c.token) destroySession(c.db, c.token);
      c.headers['Set-Cookie'] = clearCookie({ secure: c.cookieSecure });
      return { body: meBody(c.db, null) };
    },
  },
];
