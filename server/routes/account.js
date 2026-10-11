'use strict';

const { HttpError, readJson } = require('../http-util');
const { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, sha256 } = require('../auth');
const { normalizeEmail, checkLogin, checkPassword } = require('../account-rules');
const { issueToken, peekToken, consumeToken } = require('../tokens');
const { verifyEmailMessage, resetPasswordMessage } = require('../mail-templates');
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
  // IP first: an IP that is over budget must not be able to burn a victim's per-email budget.
  if (!c.limiters.mailIp.allow(c.ip, now) || !c.limiters.mailEmail.allow(email, now)) throw tooMany();
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
      // registerIp is the only bound on login-existence probing, so it is charged before login_taken.
      if (!c.limiters.registerIp.allow(c.ip, now)) throw tooMany();

      // Always pay for scrypt, so "email already registered" is not distinguishable by timing.
      const hash = hashPassword(password);
      // The login check must come before anything email-based (limiters and lookup): otherwise a taken
      // login would answer differently depending on the email (enumeration oracle), and taken nicknames
      // would burn the person's per-email budgets.
      if (c.db.prepare('SELECT 1 FROM users WHERE lower(login) = lower(?)').get(login)) {
        throw new HttpError(409, 'login_taken');
      }
      if (!c.limiters.registerEmail.allow(email, now)) throw tooMany();
      checkMailLimits(c, email);
      const byEmail = c.db
        .prepare('SELECT id, login, email, email_verified_at FROM users WHERE lower(email) = ?')
        .get(email);
      if (byEmail && byEmail.email_verified_at) return { body: GENERIC }; // verified owner: no mail, nothing created
      if (byEmail) {
        // The address is held by an UNVERIFIED account with a different login (the same login was
        // answered with login_taken above). Re-sending that account's link would hand the owner of the
        // address a session in an account whose password someone else chose (squatting an email by an
        // unverified row). Instead the stale row is deleted (its tokens cascade) and the new account is
        // created below with the requester's password. This must stay synchronous up to the INSERT.
        c.db.prepare('DELETE FROM users WHERE id = ? AND email_verified_at IS NULL').run(byEmail.id);
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
        // Handler must stay synchronous between the lookups and this INSERT; an email-index violation
        // would also map to login_taken here, which would reopen the enumeration oracle if it went async.
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
      if (!user) throw new HttpError(400, 'token_invalid');
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

function closeSessions(c, userId, exceptToken) {
  if (exceptToken) {
    c.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(exceptToken));
  } else {
    c.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

// Synchronous body only: nothing may await between BEGIN and COMMIT.
function inTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

routes.push(
  {
    method: 'POST',
    pattern: '/api/forgot-password',
    handler: async (c) => {
      requireMail(c);
      const b = await readJson(c.req);
      const email = normalizeEmail(b.email);
      if (!email) throw new HttpError(400, 'email_invalid');
      checkMailLimits(c, email);
      const user = c.db.prepare('SELECT id, login, email FROM users WHERE lower(email) = ?').get(email);
      if (user) {
        const token = issueToken(c.db, user.id, 'reset_password', c.now());
        queueMail(c, user.email, resetPasswordMessage({ login: user.login, url: `${c.publicUrl}/account#reset=${token}` }));
      }
      return { body: GENERIC };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reset-password',
    handler: async (c) => {
      const b = await readJson(c.req);
      const password = str(b.password);
      // Peek first: a rejected password must not burn the one-time token.
      const userId = peekToken(c.db, b.token, 'reset_password', c.now());
      if (userId === null) throw new HttpError(400, 'token_invalid');
      const user = c.db.prepare('SELECT id, login FROM users WHERE id = ?').get(userId);
      if (!user) throw new HttpError(400, 'token_invalid');
      const passErr = checkPassword(password, user.login);
      if (passErr) throw new HttpError(400, passErr);
      const hash = hashPassword(password);
      inTransaction(c.db, () => {
        if (consumeToken(c.db, b.token, 'reset_password', c.now()) === null) throw new HttpError(400, 'token_invalid');
        c.db
          .prepare(
            `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
               email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`,
          )
          .run(hash, userId);
        closeSessions(c, userId, null);
      });
      return { body: GENERIC };
    },
  },
  {
    method: 'POST',
    pattern: '/api/change-password',
    handler: async (c) => {
      const user = requireUser(c);
      const b = await readJson(c.req);
      const next = str(b.next);
      const passErr = checkPassword(next, user.login);
      if (passErr) throw new HttpError(400, passErr);
      // Same budget as login: a stolen session must not be able to brute-force the current password.
      if (!c.limiters.loginAccount.allow('acct:' + user.login.toLowerCase(), c.now())) throw tooMany();
      const row = c.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(str(b.current), row.password_hash)) throw new HttpError(400, 'current_password_wrong');
      const hash = hashPassword(next);
      inTransaction(c.db, () => {
        c.db
          .prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?")
          .run(hash, user.id);
        closeSessions(c, user.id, c.token);
      });
      return { body: GENERIC };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sessions',
    handler: async (c) => {
      const user = requireUser(c);
      const currentHash = sha256(c.token);
      const rows = c.db
        .prepare(
          `SELECT token_hash, created_at, last_seen_at, ip, user_agent FROM sessions
           WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC, created_at DESC`,
        )
        .all(user.id, c.now());
      return {
        body: {
          sessions: rows.map((r) => ({
            id: r.token_hash.slice(0, 16),
            createdAt: r.created_at,
            lastSeenAt: r.last_seen_at,
            ip: r.ip,
            userAgent: r.user_agent,
            current: r.token_hash === currentHash,
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sessions/revoke-others',
    handler: async (c) => {
      const user = requireUser(c);
      closeSessions(c, user.id, c.token);
      return { body: GENERIC };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/sessions/:id',
    handler: async (c) => {
      const user = requireUser(c);
      if (!/^[0-9a-f]{16}$/.test(c.params.id)) throw new HttpError(400, 'bad session id');
      const r = c.db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?')
        .run(user.id, c.params.id);
      if (r.changes === 0) throw new HttpError(404, 'not found');
      if (c.params.id === sha256(c.token).slice(0, 16)) {
        c.headers['Set-Cookie'] = clearCookie({ secure: c.cookieSecure });
      }
      return { body: GENERIC };
    },
  },
);

module.exports = routes;
