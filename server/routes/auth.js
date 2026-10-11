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
const { capabilities } = require('../permissions');

// Verified against when the login does not exist, so both failure paths cost the same time.
const DUMMY_HASH = hashPassword('timing-equalizer-password');

function me(user) {
  return {
    user: user ? { id: user.id, login: user.login, role: user.role } : null,
    can: capabilities(user),
  };
}

module.exports = [
  { method: 'GET', pattern: '/api/me', handler: async (c) => ({ body: me(c.user) }) },
  {
    method: 'POST',
    pattern: '/api/login',
    handler: async (c) => {
      if (!c.loginLimiter.allow(c.ip, c.now())) throw new HttpError(429, 'too many attempts, try again later');
      const body = await readJson(c.req);
      const login = typeof body.login === 'string' ? body.login : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const row = c.db.prepare('SELECT id, login, role, password_hash FROM users WHERE login = ?').get(login);
      const good = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
      if (!row || !good) throw new HttpError(401, 'invalid login or password');
      const token = createSession(c.db, row.id, c.now());
      c.headers['Set-Cookie'] = sessionCookie(token, { secure: c.cookieSecure });
      return { body: me(row) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/logout',
    handler: async (c) => {
      if (c.token) destroySession(c.db, c.token);
      c.headers['Set-Cookie'] = clearCookie({ secure: c.cookieSecure });
      return { body: me(null) };
    },
  },
];
