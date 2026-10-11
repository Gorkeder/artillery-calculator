'use strict';

const { HttpError, readJson } = require('../http-util');
const { hashPassword, createSession, sessionCookie } = require('../auth');
const { normalizeEmail, checkLogin, checkPassword } = require('../account-rules');
const { issueToken, consumeToken } = require('../tokens');
const { verifyEmailMessage } = require('../mail-templates');
const { meBody } = require('../me');

const GENERIC = { ok: true };

const str = (v) => (typeof v === 'string' ? v : '');
const tooMany = () => new HttpError(429, 'too many attempts, try again later');

function requireUser(c) {
  if (!c.user) throw new HttpError(401, 'login required');
  return c.user;
}

function requireMail(c) {
  if (!c.mailer.configured) throw new HttpError(503, 'mail_not_configured');
}

function checkMailLimits(c, email) {
  const now = c.now();
  if (!c.limiters.mailEmail.allow(email, now) || !c.limiters.mailIp.allow(c.ip, now)) throw tooMany();
}

// Fire and forget: the response must not depend on (or reveal) how long SMTP takes.
function queueMail(c, to, message) {
  Promise.resolve()
    .then(() => c.mailer.send({ to, ...message }))
    .catch((err) => console.error('mail send failed:', err.message));
}

function sendVerification(c, user) {
  const token = issueToken(c.db, user.id, 'verify_email', c.now());
  queueMail(c, user.email, verifyEmailMessage({ login: user.login, url: `${c.publicUrl}/account#verify=${token}` }));
}

const routes = [
  {
    method: 'POST',
    pattern: '/api/register',
    handler: async (c) => {
      requireMail(c);
      const now = c.now();
      if (!c.limiters.registerIp.allow(c.ip, now)) throw tooMany();
      const b = await readJson(c.req);
      if (typeof b.website === 'string' && b.website !== '') return { body: GENERIC }; // honeypot
      const login = str(b.login);
      const password = str(b.password);
      const email = normalizeEmail(b.email);
      const loginErr = checkLogin(login);
      if (loginErr) throw new HttpError(400, loginErr);
      if (!email) throw new HttpError(400, 'email_invalid');
      const passErr = checkPassword(password, login);
      if (passErr) throw new HttpError(400, passErr);
      if (b.consent !== true) throw new HttpError(400, 'consent_required');
      if (!c.limiters.registerEmail.allow(email, now)) throw tooMany();
      checkMailLimits(c, email);

      // Always pay for scrypt, so "email already registered" is not distinguishable by timing.
      const hash = hashPassword(password);
      const byEmail = c.db
        .prepare('SELECT id, login, email, email_verified_at FROM users WHERE lower(email) = ?')
        .get(email);
      if (byEmail) {
        if (!byEmail.email_verified_at) sendVerification(c, byEmail);
        return { body: GENERIC };
      }
      if (c.db.prepare('SELECT 1 FROM users WHERE lower(login) = lower(?)').get(login)) {
        throw new HttpError(409, 'login_taken');
      }
      let id;
      try {
        const r = c.db
          .prepare(
            `INSERT INTO users (login, password_hash, role, email, password_changed_at)
             VALUES (?, ?, 'user', ?, datetime('now'))`,
          )
          .run(login, hash, email);
        id = Number(r.lastInsertRowid);
      } catch (err) {
        if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'login_taken');
        throw err;
      }
      sendVerification(c, { id, login, email });
      return { body: GENERIC };
    },
  },
  {
    method: 'POST',
    pattern: '/api/verify-email',
    handler: async (c) => {
      const b = await readJson(c.req);
      const userId = consumeToken(c.db, b.token, 'verify_email', c.now());
      if (userId === null) throw new HttpError(400, 'token_invalid');
      c.db
        .prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL")
        .run(userId);
      const user = c.db.prepare('SELECT id, login, role FROM users WHERE id = ?').get(userId);
      const session = createSession(c.db, userId, c.now(), undefined, c.clientMeta);
      c.headers['Set-Cookie'] = sessionCookie(session, { secure: c.cookieSecure });
      return { body: meBody(c.db, user) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/resend-verification',
    handler: async (c) => {
      requireMail(c);
      const b = await readJson(c.req);
      const email = normalizeEmail(b.email);
      if (!email) throw new HttpError(400, 'email_invalid');
      checkMailLimits(c, email);
      const user = c.db
        .prepare('SELECT id, login, email, email_verified_at FROM users WHERE lower(email) = ?')
        .get(email);
      if (user && !user.email_verified_at) sendVerification(c, user);
      return { body: GENERIC };
    },
  },
];

module.exports = routes;
