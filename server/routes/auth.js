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
const { normalizeEmail } = require('../account-rules');

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
      const isEmail = ident.includes('@');
      // An @ identifier is looked up (and rate limited) by its normalized form; one that does not
      // normalize is an unknown account: same 401 path, same dummy-hash cost.
      const email = isEmail ? normalizeEmail(ident) : null;
      const key = isEmail && email ? email : ident.toLowerCase();
      if (!c.limiters.loginAccount.allow('acct:' + key, now)) {
        throw new HttpError(429, 'too many attempts, try again later');
      }
      let row = null;
      if (!isEmail) row = c.db.prepare(BY_LOGIN).get(ident);
      else if (email) row = c.db.prepare(BY_EMAIL).get(email);
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
